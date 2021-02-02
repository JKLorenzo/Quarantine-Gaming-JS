const Discord = require('discord.js');
const fetch = require('node-fetch');
const probe = require('probe-image-size');
const constants = require('./constants.js');
const functions = require('./functions.js');
const classes = require('./classes.js');
/** @type {import('./app.js')} */
let app;
/** @type {import('./error_manager.js')} */
let error_manager;
/** @type {import('./message_manager.js')} */
let message_manager;
/** @type {import('./reaction_manager.js')} */
let reaction_manager;
/** @type {import('./role_manager.js')} */
let role_manager;
/** @type {import('./channel_manager.js')} */
let channel_manager;
/** @type {import('./database.js')} */
let database;
/** @type {import('./speech.js')} */
let speech;

const ErrorTicketManager = new classes.ErrorTicketManager('general.js');
const OfflineManager = new classes.ProcessQueue(1000);
const ActivityManager = new classes.ProcessQueue(500);
const VoiceManager = new classes.ProcessQueue(500);
const DedicateManager = new classes.ProcessQueue(5000);
const FreeGameUpdateManager = new classes.ProcessQueue(1500000); // 25mins
/** @type {Array<classes.Notification>} */
let freeGameCollection = new Array();

/**
 * Initializes the module.
 * @param {Function} ModulesFunction The GlobalModules function.
 */
module.exports.initialize = (ModulesFunction) => {
    // Link
    const Modules = functions.parseModules(ModulesFunction);
    app = Modules.app;
    error_manager = Modules.error_manager;
    message_manager = Modules.message_manager;
    reaction_manager = Modules.reaction_manager;
    role_manager = Modules.role_manager;
    channel_manager = Modules.channel_manager;
    database = Modules.database;
    speech = Modules.speech;
}

/**
 * Checks for users on the server with no member role.
 */
module.exports.memberUnlisted = async () => {
    try {
        for (const this_member of app.guild().members.cache.array()) {
            if (this_member && !this_member.user.bot && !app.hasRole(this_member, [constants.roles.member])) {
                await this.memberScreening(this_member);
            }
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('memberUnlisted', error));
    }
}


/**
 * Adds the member to the screening process.
 * @param {Discord.GuildMember} this_member The GuildMember object to undergo screening.
 * @returns {Promise<Discord.Message>} The Message object of the screening process.
 */
module.exports.memberScreening = (this_member) => {
    return new Promise(async (resolve, reject) => {
        try {
            const MessageToSend = new Array();
            MessageToSend.push(`Hi ${this_member.user.username}, and welcome to **Quarantine Gaming**!`);
            MessageToSend.push(`Please wait while we are processing your membership approval.`);
            await message_manager.sendToUser(this_member, MessageToSend.join('\n'))

            const today = new Date();
            const diffMs = (today - this_member.user.createdAt);
            const diffDays = Math.floor(diffMs / 86400000)
            const diffHrs = Math.floor((diffMs % 86400000) / 3600000)
            const diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000);
            const created_on = diffDays + " days " + diffHrs + " hours " + diffMins + " minutes";
            const inviters = await app.getInvites();

            const embed = new Discord.MessageEmbed();
            embed.setAuthor('Quarantine Gaming: Member Approval');
            embed.setTitle('Member Details');
            embed.setThumbnail(this_member.user.displayAvatarURL());
            embed.addFields([
                { name: 'User:', value: this_member },
                { name: 'Account Created:', value: created_on },
                { name: 'Inviter:', value: inviters.length > 0 ? inviters.map(this_invite => this_invite.inviter).join(' or ') : 'Information is not available.' },
                { name: 'Actions:', value: '✅ - Approve     ❌ - Kick     ⛔ - Ban' }
            ]);
            embed.setColor('#25c059');
            const Message = await message_manager.sendToChannel(constants.channels.server.management, {
                content: `${this_member} wants to join this server. ${app.role(constants.roles.staff)} or ${app.role(constants.roles.moderator)} action is required.`,
                embed: embed
            });
            const reactions = ['✅', '❌', '⛔'];
            for (const emoji of reactions) {
                await reaction_manager.addReaction(Message, emoji);
            }
            resolve(Message);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Performs processes that clears the status of this member on this server.
 * @param {Discord.GuildMember} member The guild member object.
 */
module.exports.memberOffline = async (member) => {
    await OfflineManager.queue();
    try {
        // Remove Streaming Role
        if (app.hasRole(member, [constants.roles.streaming])) {
            role_manager.remove(member, constants.roles.streaming);
        }

        // Remove Dedicated Channel Role
        if (app.hasRole(member, [constants.roles.dedicated])) {
            role_manager.remove(member, constants.roles.dedicated);
        }

        // Remove all Dedicated Channel's Text Channel Roles
        for (const text_channel_role of member.roles.cache.array().filter(role => role.name.startsWith('Text'))) {
            role_manager.remove(member, text_channel_role);
        }

        // Remove all Team Roles
        for (const team_role of member.roles.cache.array().filter(role => role.name.startsWith('Team'))) {
            role_manager.remove(member, team_role);
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('memberOffline', error));
    }
    OfflineManager.finish();
}

/**
 * Performs processes that updates the status of this member through this activity.
 * @param {Discord.GuildMember} member The guild member object.
 * @param {{activity: Discord.Activity, new: Boolean}} data The activity and state of this change.
 */
module.exports.memberActivityUpdate = async (member, data) => {
    await ActivityManager.queue();
    try {
        const activity = data.activity;
        const activity_name = activity.name.trim();
        if (activity.type == 'PLAYING' && !database.gameBlacklisted(activity_name) && (activity.applicationID || database.gameWhitelisted(activity_name))) {
            const streaming_role = app.role(constants.roles.streaming);
            const game_role = app.guild().roles.cache.find(role => role.name == activity_name) || await role_manager.create({ name: activity_name, color: '0x00ffff' });
            let play_role = app.guild().roles.cache.find(role => role.name == 'Play ' + activity_name);

            if (!app.guild().roles.cache.find(role => role.name == activity_name + ' ⭐')) await role_manager.create({ name: activity_name + ' ⭐', color: '0x00fffe' });

            if (data.new) {
                if (play_role) {
                    // Bring Play Role to Top
                    play_role.setPosition(streaming_role.position - 1);
                } else {
                    // Create Play Role
                    play_role = await role_manager.create({ name: 'Play ' + activity_name, color: '0x7b00ff', position: streaming_role.position, hoist: true });
                }
                role_manager.add(member, game_role);
                role_manager.add(member, play_role);
            } else if (play_role) {
                // Remove Play Role from this member
                if (member.roles.cache.has(play_role.id)) {
                    role_manager.remove(member, play_role);
                }
                // Check if Play Role is still in use
                let role_in_use = false;
                for (const this_member of app.guild().members.cache.array()) {
                    if (this_member.roles.cache.find(role => role == play_role)) {
                        // Check if this member is still playing
                        if (this_member.presence.activities.map(activity => activity.name.trim()).includes(play_role.name.substring(5))) {
                            role_in_use = true;
                        }
                    }
                }
                // Delete inactive Play Roles
                if (!role_in_use) {
                    // Delete Play Role
                    role_manager.delete(play_role);
                }
            }
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('memberActivityUpdate', error));
    }
    ActivityManager.finish();
}

/**
 * Performs processes that updates the status of this member through this voice state.
 * @param {Discord.GuildMember} member A guild member object.
 * @param {Discord.VoiceState} oldState The old voice state object.
 * @param {Discord.VoiceState} newState The new voice state object.
 */
module.exports.memberVoiceUpdate = async (member, oldState, newState) => {
    await VoiceManager.queue();
    try {
        if (oldState.channel && oldState.channel.parent.id == constants.channels.category.dedicated) {
            const text_channel = app.channel(constants.channels.category.dedicated).children.find(channel => channel.type == 'text' && channel.topic && functions.parseMention(channel.topic.split(' ')[0]) == oldState.channelID);
            const linked_data = text_channel.topic.split(' ');
            const text_role = app.role(linked_data[1]);
            const team_role = app.role(linked_data[2]);

            if (oldState.channel.members.size > 0 && !(oldState.channel.members.size == 1 && oldState.channel.members.first().user.bot)) {
                role_manager.remove(member, text_role);
                role_manager.remove(member, team_role);
                const embed = new Discord.MessageEmbed();
                embed.setAuthor('Quarantine Gaming: Dedicated Channels');
                embed.setTitle(oldState.channel.name);
                embed.setDescription(`${oldState.member} left this channel.`);
                embed.setThumbnail(member.user.displayAvatarURL());
                embed.setFooter(`${member.user.tag} (${member.user.id})`);
                embed.setTimestamp();
                embed.setColor('#7b00ff');
                message_manager.sendToChannel(text_channel, embed);
            } else {
                channel_manager.delete(oldState.channel);
                channel_manager.delete(text_channel);
                role_manager.delete(text_role);
                role_manager.delete(team_role);
            }
        }

        if (newState.channel) {
            // Check if members are streaming
            const streamers = new Array();
            for (const this_member of newState.channel.members.array()) {
                if (member.user.id != this_member.user.id && this_member.roles.cache.has(constants.roles.streaming)) {
                    streamers.push(this_member);
                }
            }
            // Notify member
            if (streamers.length > 0) {
                const embed = new Discord.MessageEmbed();
                embed.setAuthor('Quarantine Gaming: Information');
                embed.setTitle(`${streamers.length > 1 ? `${streamers.map(member => member.displayName).join(' and ')} are` : `${streamers.map(member => member.displayName)} is`} currently Streaming`);
                embed.setDescription('Please observe proper behavior on your current voice channel.');
                embed.setImage('https://pa1.narvii.com/6771/d33918fa87ad0d84b7dc854dcbf6a8545c73f94d_hq.gif');
                embed.setColor('#5dff00');
                message_manager.sendToUser(member, embed);
            }

            if (newState.channel.parent.id == constants.channels.category.dedicated) {
                const text_channel = app.channel(constants.channels.category.dedicated).children.find(channel => channel.type == 'text' && channel.topic && functions.parseMention(channel.topic.split(' ')[0]) == newState.channelID);
                const linked_data = text_channel.topic.split(' ');
                const text_role = app.role(linked_data[1]);
                const team_role = app.role(linked_data[2]);

                // Add Text Role
                if (!member.roles.cache.has(text_role.id)) {
                    const embed = new Discord.MessageEmbed();
                    embed.setAuthor('Quarantine Gaming: Dedicated Channels');
                    embed.setTitle(newState.channel.name);
                    embed.setDescription(`${newState.member} joined this channel.`);
                    embed.setThumbnail(newState.member.user.displayAvatarURL());
                    embed.setFooter(`${newState.member.user.tag} (${newState.member.user.id})`);
                    embed.setTimestamp();
                    embed.setColor('#7b00ff');
                    message_manager.sendToChannel(text_channel, embed);
                    role_manager.add(member, text_role);
                }

                // Add Team Role
                if (!member.roles.cache.has(team_role.id)) {
                    role_manager.add(member, team_role);
                }

                // Add Dedicated Role
                if (!member.roles.cache.has(constants.roles.dedicated)) {
                    role_manager.add(member, constants.roles.dedicated);
                }
            } else {
                // Remove Text Role
                if (member.roles.cache.has(constants.roles.dedicated)) {
                    role_manager.remove(member, constants.roles.dedicated);
                }
            }
        } else {
            // Remove Streaming Role
            if (member.roles.cache.has(constants.roles.streaming)) {
                role_manager.remove(member, constants.roles.streaming)
            }
            // Remove Text Role
            if (member.roles.cache.has(constants.roles.dedicated)) {
                role_manager.remove(member, constants.roles.dedicated);
            }
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('memberVoiceUpdate', error));
    }
    VoiceManager.finish();
}

/**
 * Creates a game invite and player bracket.
 * @param {Discord.Role} role The mentionable role.
 * @param {Discord.GuildMember} inviter The member who initiated the invite.
 * @param {Number} count Number of players the inviter is looking for.
 * @param {Array<Discord.GuildMember>} reserved_members List of members that is reserved to this bracket.
 */
module.exports.gameInvite = async (role, inviter, count, reserved_members) => {
    try {
        const mention_role = app.guild().roles.cache.find(this_role => this_role.hexColor == '#00ffff' && role.name.startsWith(this_role.name));
        if (mention_role) {
            const embed = new Discord.MessageEmbed();
            embed.setAuthor('Quarantine Gaming: Game Coordinator');
            embed.setTitle(mention_role.name);
            embed.addField(`Player 1:`, inviter);

            let reserved_count = 2;
            const members = new Array();
            if (reserved_members.length > 0) {
                for (const this_member of reserved_members) {
                    if (this_member && !members.includes(this_member)) {
                        members.push(this_member);
                        if (this_member.user.id != inviter.user.id) {
                            embed.addField(`Player ${reserved_count++}:`, this_member);
                        }
                    }
                }
            }
            if (count == 0) {
                embed.setDescription(`${inviter.displayName} wants to play ${mention_role}.`);
            } else {
                embed.setDescription(`${inviter.displayName} is looking for **${count - 1}** other ${mention_role} player${count == 2 ? '' : 's'}.`);
                for (let i = reserved_count; i <= count; i++) {
                    embed.addField(`Player ${i}:`, '\u200B');
                }
            }

            const is_full = count != 0 && members.length + 1 >= count;
            if (is_full) {
                embed.setFooter('Closed. This bracket is now full.');
            } else {
                embed.setFooter(`Join this bracket by reacting below.`);
            }
            embed.setColor('#7b00ff');

            const emoji = app.guild().emojis.cache.find(emoji => emoji.name == functions.toAlphanumericString(mention_role.name));
            const qg_emoji = app.guild().emojis.cache.find(emoji => emoji.name == 'quarantinegaming');
            if (emoji) {
                embed.setThumbnail(emoji.url);
            } else {
                embed.setThumbnail(qg_emoji.url);
            }

            const this_message = await message_manager.sendToChannel(constants.channels.integrations.game_invites, { content: `${inviter.displayName} is inviting you to play ${mention_role}!`, embed: embed })
            this_message.delete({ timeout: 3600000 }).catch(() => { });
            if (!is_full) {
                await reaction_manager.addReaction(this_message, emoji ? emoji : qg_emoji).catch(error => error_manager.mark(ErrorTicketManager.create('addReaction', error, 'gameInvite')));
            }
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('gameInvite', error));
    }
}

/**
 * Creates a dedicated voice and text channels with a team role connected to it.
 * @param {Discord.VoiceChannel} channel_origin The voice room to transfer to the dedicated channel.
 * @param {String} name The name of the dedicated channel.
 */
module.exports.dedicateChannel = async (channel_origin, name) => {
    await DedicateManager.queue();
    try {
        const channel_name = '🔰' + name;
        if (channel_origin.parentID == constants.channels.category.dedicated) {
            // Rename
            await channel_origin.setName(channel_name);
            const text_channel = app.channel(constants.channels.category.dedicated).children.find(channel => channel.type == 'text' && channel.topic && channel.topic.split(' ')[0] == channel_origin.id);
            await text_channel.setName(channel_name);
            const hoisted_role = app.role(text_channel.topic.split(' ')[2]);
            await hoisted_role.setName(`Team ${channel_name}`);

            // Set info
            const channel_desc = new Array();
            channel_desc.push(`• Only members who are in this voice channel can view this text channel.`);
            channel_desc.push(`• You can't view other dedicated channels once you're connected to one.`);
            channel_desc.push(`• ${text_channel} voice and text channels will automatically be deleted once everyone is disconnected from these channels.`);
            channel_desc.push(`• You can lock this channel by doing **!dedicate lock**, and you can do **!dedicate unlock** to unlock it.`);
            channel_desc.push(`• You can transfer anyone from another voice channel to this voice channel by doing **!transfer <@member>**.\n\u200b\u200bEx: "!transfer ${app.client().user}"`);
            channel_desc.push(`• You can also transfer multiple users at once.\n\u200b\u200bEx: "!transfer ${app.client().user} ${app.client().user}"`);
            channel_desc.push(`Note: ${app.role(constants.roles.staff)}, ${app.role(constants.roles.moderator)}, and ${app.role(constants.roles.music_bot)} can interact with these channels.`);
            const embed = new Discord.MessageEmbed();
            embed.setAuthor('Quarantine Gaming: Dedicated Channels');
            embed.setTitle(`Voice and Text Channels for ${channel_name}`);
            embed.setDescription(channel_desc.join('\n\n'));
            embed.setColor('#7b00ff');

            const profile = app.guild().members.cache.find(member => member.displayName == name);
            const emoji = app.guild().emojis.cache.find(emoji => emoji.name == name.split(' ').join('').split(':').join('').split('-').join(''));
            const qg_emoji = app.guild().emojis.cache.find(emoji => emoji.name == 'quarantinegaming');
            if (profile) {
                embed.setThumbnail(profile.user.displayAvatarURL());
            } else if (emoji) {
                embed.setThumbnail(emoji.url);
            } else {
                embed.setThumbnail(qg_emoji.url);
            }

            message_manager.sendToChannel(text_channel, embed);
        } else {
            // Notify
            await speech.say(`Transferring to ${name} dedicated channel. Please wait.`, channel_origin);

            const p = constants.permissions;
            const dedicated_voice_channel = await channel_manager.create({
                name: channel_name,
                type: 'voice',
                parent: constants.channels.category.dedicated,
                position: 1,
                permissionOverwrites: [
                    {
                        id: constants.roles.everyone,
                        deny: [
                            p.general.CREATE_INVITE,
                            p.general.MANAGE_CHANNELS,
                            p.general.MANAGE_PERMISSIONS,
                            p.general.MANAGE_WEBHOOKS,
                            p.voice.CONNECT,
                            p.voice.MUTE_MEMBERS,
                            p.voice.DEAFEN_MEMBERS,
                            p.voice.MOVE_MEMBERS,
                            p.voice.PRIORITY_SPEAKER
                        ]
                    },
                    {
                        id: constants.roles.dedicated,
                        deny: [
                            p.general.VIEW_CHANNEL
                        ]
                    },
                    {
                        id: constants.roles.member,
                        allow: [
                            p.voice.CONNECT,
                            p.voice.SPEAK,
                            p.voice.VIDEO
                        ],
                    },
                    {
                        id: constants.roles.moderator,
                        allow: [
                            p.general.CREATE_INVITE,
                            p.general.MANAGE_CHANNELS,
                            p.voice.CONNECT,
                            p.voice.MUTE_MEMBERS,
                            p.voice.DEAFEN_MEMBERS,
                            p.voice.MOVE_MEMBERS,
                            p.voice.PRIORITY_SPEAKER
                        ]
                    },
                    {
                        id: constants.roles.music_bot,
                        allow: [
                            p.voice.CONNECT,
                            p.voice.SPEAK,
                            p.voice.USE_VOICE_ACTIVITY
                        ]
                    }
                ],
                bitrate: 128000
            });

            const dedicated_text_role = await role_manager.create({
                name: `Text ${dedicated_voice_channel.id}`
            });

            const team_role = await role_manager.create({
                name: `Team ${channel_name}`,
                position: app.role(constants.roles.dedicated).position,
                hoist: true
            });

            const dedicated_text_channel = await channel_manager.create({
                name: channel_name,
                type: 'text',
                parent: constants.channels.category.dedicated,
                position: 1,
                permissionOverwrites: [
                    {
                        id: constants.roles.everyone,
                        deny: [
                            p.general.VIEW_CHANNEL,
                            p.general.CREATE_INVITE,
                            p.general.MANAGE_CHANNELS,
                            p.general.MANAGE_PERMISSIONS,
                            p.general.MANAGE_WEBHOOKS,
                            p.text.MENTION_EVERYONE,
                            p.text.MANAGE_MESSAGES
                        ]
                    },
                    {
                        id: constants.roles.music_bot,
                        allow: [
                            p.general.VIEW_CHANNEL,
                            p.text.ADD_REACTIONS,
                            p.text.EMBED_LINKS,
                            p.text.SEND_MESSAGES
                        ]
                    },
                    {
                        id: dedicated_text_role.id,
                        allow: [
                            p.general.VIEW_CHANNEL,
                            p.text.SEND_TTS_MESSAGES,
                            p.text.EMBED_LINKS,
                            p.text.ATTACH_FILES,
                        ]
                    },
                    {
                        id: constants.roles.moderator,
                        allow: [
                            p.general.VIEW_CHANNEL,
                            p.general.CREATE_INVITE,
                            p.general.MANAGE_CHANNELS,
                            p.text.MENTION_EVERYONE,
                            p.text.MANAGE_MESSAGES
                        ]
                    },
                ],
                topic: `${dedicated_voice_channel} ${dedicated_text_role} ${team_role}`
            });

            await dedicated_voice_channel.updateOverwrite(dedicated_text_role, {
                VIEW_CHANNEL: true
            });

            // Set info
            const channel_desc = new Array();
            channel_desc.push(`• Only members who are in this voice channel can view this text channel.`);
            channel_desc.push(`• You can't view other dedicated channels once you're connected to one.`);
            channel_desc.push(`• ${dedicated_text_channel} voice and text channels will automatically be deleted once everyone is disconnected from these channels.`);
            channel_desc.push(`• You can lock this channel by doing **!dedicate lock**, and you can do **!dedicate unlock** to unlock it.`);
            channel_desc.push(`• You can transfer anyone from another voice channel to this voice channel by doing **!transfer <@member>**.\n\u200b\u200bEx: "!transfer ${app.client().user}"`);
            channel_desc.push(`• You can also transfer multiple users at once.\n\u200b\u200bEx: "!transfer ${app.client().user} ${app.client().user}"`);
            channel_desc.push(`Note: ${app.role(constants.roles.staff)}, ${app.role(constants.roles.moderator)}, and ${app.role(constants.roles.music_bot)} can interact with these channels.`);
            const embed = new Discord.MessageEmbed();
            embed.setAuthor('Quarantine Gaming: Dedicated Channels');
            embed.setTitle(`Voice and Text Channels for ${channel_name}`);
            embed.setDescription(channel_desc.join('\n\n'));
            embed.setColor('#7b00ff');

            const profile = app.guild().members.cache.find(member => member.displayName == name);
            const emoji = app.guild().emojis.cache.find(emoji => emoji.name == name.split(' ').join('').split(':').join('').split('-').join(''));
            const qg_emoji = app.guild().emojis.cache.find(emoji => emoji.name == 'quarantinegaming');
            if (profile) {
                embed.setThumbnail(profile.user.displayAvatarURL());
            } else if (emoji) {
                embed.setThumbnail(emoji.url);
            } else {
                embed.setThumbnail(qg_emoji.url);
            }

            await message_manager.sendToChannel(dedicated_text_channel, embed);

            // Sort members
            const streamers = [], members = [];
            for (const this_member of channel_origin.members.array()) {
                if (this_member.roles.cache.has(constants.roles.streaming)) {
                    streamers.push(this_member);
                } else {
                    members.push(this_member);
                }
            }
            // Transfer streamers
            for (const this_member of streamers) {
                await this_member.voice.setChannel(dedicated_voice_channel);
                await functions.sleep(2000);
            }
            // Transfer members
            for (const this_member of members) {
                if (this_member.user.id != constants.me) {
                    await this_member.voice.setChannel(dedicated_voice_channel);
                    await functions.sleep(2000);
                }
            }
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('dedicateChannel', error));
    }
    DedicateManager.finish();
}

/**
 * Fetches the first 25 posts then are tested against the database to check for new posts.
 * @param {String} url The specific URL to fetch that ignores the creation date criteria.
 * @returns {String} The status of the fetch when URL is provided.
 */
module.exports.freeGameFetch = async (url = '') => {
    try {
        const response = await fetch('https://www.reddit.com/r/FreeGameFindings/new/.json?limit=25&sort=new').then(data => data.json()).then(entry => entry.data.children.map(child => child.data));
        if (response) {
            freeGameCollection = new Array();
            for (const data of response) {
                const notification = new classes.Notification(functions.parseHTML(data.title), data.url, data.author, `https://www.reddit.com${data.permalink}`, {
                    createdAt: data.created_utc,
                    description: functions.parseHTML(data.selftext),
                    flair: data.link_flair_text,
                    score: data.score,
                    validity: data.upvote_ratio * 100
                });

                freeGameCollection.push(notification);

                const this_notification = database.notificationRecords(notification);
                if (url) {
                    if (url.trim().toLowerCase() == notification.url.trim().toLowerCase() || url.trim().toLowerCase() == notification.permalink.trim().toLowerCase()) {
                        if (!this_notification) {
                            this.freeGameNotify(notification);
                            return 'Got it! Inserting this entry to processing queue for validation.';
                        } else {
                            return 'This entry is already posted on the free games channel.';
                        }
                    }
                } else {
                    const elapsedMinutes = functions.compareDate(new Date(notification.createdAt * 1000)).minutes;
                    if (!this_notification && elapsedMinutes >= 30 && elapsedMinutes <= 300 && notification.score >= 50 && notification.validity >= 75) {
                        this.freeGameNotify(notification);
                    }
                }
            }
            if (url) return 'Uh-oh! The link you provided is no longer valid.';
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('freeGameFetch', error));
    }
}

/**
 * Updates all active notifications.
 */
module.exports.freeGameUpdate = async () => {
    try {
        for (const notification of freeGameCollection) {
            const this_notification = database.notificationRecords(notification);
            if (this_notification) {
                const message = await app.channel(constants.channels.integrations.free_games).messages.fetch(this_notification.id);
                if (message) {
                    await FreeGameUpdateManager.queue();
                    if (notification.description) {
                        message.embeds[0].spliceFields(1, 3)
                            .addFields([
                                { name: 'Trust Factor', value: `${notification.validity} %`, inline: true },
                                { name: 'Margin', value: `${notification.score}`, inline: true },
                                { name: 'Details', value: `${notification.description}` }
                            ]).setTimestamp();
                    } else {
                        message.embeds[0].spliceFields(1, 2)
                            .addFields([
                                { name: 'Trust Factor', value: `${notification.validity} %`, inline: true },
                                { name: 'Margin', value: `${notification.score}`, inline: true }
                            ]).setTimestamp();
                    }
                    if (notification.flair) {
                        if (functions.contains(notification.flair.toLowerCase(), ['comment', 'issue'])) {
                            message.embeds[0].setDescription(`[${notification.flair}](${notification.permalink})`);
                        } else {
                            message.embeds[0].setDescription(notification.flair);
                        }
                    }
                    await message.edit({ content: message.content, embed: message.embeds[0] });
                    FreeGameUpdateManager.finish();
                }
            }
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('freeGameUpdate', error));
    }
}

/**
 * Sends the notification to the free games channel.
 * @param {classes.Notification} notification The notification object to send.
 */
module.exports.freeGameNotify = async (notification) => {
    try {
        const title = notification.title;
        const url = notification.url;
        const author = notification.author;
        const description = notification.description;
        const validity = notification.validity;
        const score = notification.score;
        const flair = notification.flair;
        const permalink = notification.permalink;

        const embed = new Discord.MessageEmbed().setTimestamp();
        embed.setAuthor('Quarantine Gaming: Free Game/DLC Notification');
        if (flair) {
            if (flair.toLowerCase().indexOf('comment') !== -1 || flair.toLowerCase().indexOf('issue') !== -1) {
                embed.setDescription(`[${flair}](${permalink})`);
            } else {
                embed.setDescription(flair);
            }
        }
        embed.addFields([
            { name: 'Author', value: author, inline: true },
            { name: 'Trust Factor', value: `${validity} %`, inline: true },
            { name: 'Margin', value: `${score}`, inline: true }
        ]);
        if (description) {
            embed.addField('Details', description);
        }

        // Title
        const safe_title = [], exclude_title = [], filtered_content = [];
        if (title) {
            const words = title.split(' ');
            const filters = ['other', 'alpha', 'beta', 'psa'];
            for (const word of words) {
                // Check if the word is not one of the classifiers
                if (!word.startsWith('[') && !word.startsWith('(') && !word.endsWith(']') && !word.endsWith(')')) {
                    safe_title.push(word);
                } else {
                    exclude_title.push(word);
                    for (const filter of filters) {
                        if (functions.contains(word, filter)) {
                            filtered_content.push(word);
                        }
                    }
                }
            }
            embed.setTitle(`**${safe_title.length > 0 ? safe_title.join(' ') : title}**`);
        }

        // URL
        embed.setURL(url);
        const hostname = (new URL(url)).hostname;
        embed.setFooter(`${hostname} | Updated as of `, functions.fetchIcon(hostname));

        // Image
        const images = await functions.fetchImage(title).catch(() => { });
        for (const image of images) {
            const response = await fetch(image.url).catch(() => { });
            if (response && response.ok) {
                const probe_result = await probe(image.url, { timeout: 10000 }).catch(() => { });
                if (probe_result) {
                    const width = parseInt(probe_result.width);
                    const height = parseInt(probe_result.height);
                    const ratio = width / height;
                    if (width >= 200 && height >= 200 && ratio >= 1.7) {
                        embed.setImage(probe_result.url);
                        break;
                    }
                }
            }
        }
        if (!embed.image.url) embed.setImage(constants.images.free_games_banner);

        const color = new classes.Color();
        const mentionables = new Array();
        const searchables = (description ? description.toLowerCase() : '*') + ' ' + (url ? url.toLowerCase() : '*');

        if (functions.contains(searchables, 'steampowered.com')) {
            mentionables.push(constants.roles.steam);
            color.add(0, 157, 255);
        }
        if (functions.contains(searchables, 'epicgames.com')) {
            mentionables.push(constants.roles.epic);
            color.add(157, 255, 0);
        }
        if (functions.contains(searchables, 'gog.com')) {
            mentionables.push(constants.roles.gog);
            color.add(157, 0, 255);
        }
        if (functions.contains(searchables, 'ubisoft.com')) {
            mentionables.push(constants.roles.ubisoft);
            color.add(200, 120, 255);
        }
        if (functions.contains(searchables, ['playstation.com', 'wii.com', 'xbox.com', 'microsoft.com'])) {
            mentionables.push(constants.roles.console);
            color.add(200, 80, 200)
        }

        embed.setColor(color.toHex());
        if (filtered_content.length == 0 && mentionables.length > 0) {
            const sent_mesage = await message_manager.sendToChannel(constants.channels.integrations.free_games, { content: embed.title + ' is now available on ' + mentionables.map(mentionable => app.role(mentionable)).join(' and ') + '.', embed: embed });
            notification.title = embed.title;
            notification.id = sent_mesage.id;
            await database.notificationPush(notification);

            // Crosspost a message
            if (sent_mesage.channel.type === 'news') {
                await sent_mesage.crosspost();
                const crosspost_embed = new Discord.MessageEmbed();
                crosspost_embed.setColor('#da00ff');
                crosspost_embed.setAuthor('Quarantine Gaming: Free Game/DLC Crossposting');
                crosspost_embed.setTitle(sent_mesage.embeds[0].title);
                crosspost_embed.setDescription('This notification is now published and is visible to all external(following) servers.')
                await message_manager.sendToChannel(constants.channels.qg.logs, crosspost_embed);
            }
        }
    } catch (error) {
        error_manager.mark(ErrorTicketManager.create('freeGameNotify', error));
    }
}