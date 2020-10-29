const { MessageEmbed } = require('discord.js');

const invite = async function (role, member, count, reserved) {
    let embed = new MessageEmbed();
    embed.setAuthor('Quarantine Gaming: Game Coordinator');
    embed.setTitle(role.name);
    embed.addField(`Player 1:`, member.toString());
    let reserved_count = 2;
    let members = [];
    if (reserved) {
        for (let user of reserved.split(' ')) {
            let user_id = user.split('<@').join('').split('>').join('').slice(1);
            let this_member = g_channels.get().guild.members.cache.get(user_id);
            if (this_member && !members.includes(this_member)) {
                members.push(this_member);
            }
        }
        for (let this_member of members) {
            if (this_member.user.id != member.user.id) {
                embed.addField(`Player ${reserved_count++}:`, this_member.toString());
            }
        }
    }
    if (count == 0) {
        embed.setDescription(`${member.displayName} wants to play ${role}.`);
    } else {
        embed.setDescription(`${member.displayName} is looking for **${count - 1}** other ${role} player${count == 2 ? '' : 's'}.`);
        for (let i = reserved_count; i <= count; i++) {
            embed.addField(`Player ${i}:`, '\u200B');
        }
    }

    let is_full = count != 0 && members.length + 1 >= count;
    if (is_full) {
        embed.setFooter('Closed. This bracket is now full.');
    } else {
        embed.setFooter(`Join this bracket by reacting below.`);
    }
    embed.setColor('#7b00ff');

    let emoji = g_channels.get().guild.emojis.cache.find(emoji => emoji.name == role.name.split(' ').join('').split(':').join('').split('-').join(''));
    let qg_emoji = g_channels.get().guild.emojis.cache.find(emoji => emoji.name == 'quarantinegaming');
    if (emoji) {
        embed.setThumbnail(emoji.url);
    } else {
        embed.setThumbnail(qg_emoji.url);
    }
    await g_channels.get().gaming.send({ content: `Inviting all ${role} players!`, embed: embed }).then(async message => {
        message.delete({ timeout: 3600000, reason: 'Timed Out' }).catch(error => { });
        if (!is_full) {
            await message.react(emoji ? emoji : qg_emoji).catch(error => {
                g_interface.on_error({
                    name: 'run -> .react()',
                    location: 'play.js',
                    error: error
                });
            });
        }
    }).catch(error => {
        g_interface.on_error({
            name: 'run -> .say()',
            location: 'play.js',
            error: error
        });
    });
}

let coordinator_queue = new Array(), is_processing = false;
const queue = function (data) {
    coordinator_queue.push(data);

    if (!is_processing) {
        beginProcess();
    }
}

async function beginProcess() {
    is_processing = true;
    while (coordinator_queue.length > 0) {
        let this_data = coordinator_queue.shift();
        let status = this_data.status;
        let member = this_data.member;

        await g_channels.get().gaming.messages.fetch(this_data.message.id).then(async message => {
            let embed = message.embeds[0];
            let inviter_id = embed.fields[0].value.substring(2, embed.fields[0].value.length - 1);
            let inviter = g_channels.get().guild.members.cache.find(member => member.id == inviter_id);

            if (inviter_id != member.id && embed.footer.text != 'Closed. This bracket is now full.') {
                let players = [];
                let max = embed.fields.length;
                let cur = 0;
                let has_caps = false;

                if (embed.description.indexOf('is looking for') !== -1) has_caps = true;
                switch (status) {
                    case 1:
                        let inserted = false;
                        for (let field of embed.fields) {
                            if (field.value != '\u200b') {
                                players.push(field.value);
                                cur++;
                                if (field.value.indexOf(member.id) !== -1) {
                                    inserted = true;
                                }
                            }
                        }

                        embed = embed.spliceFields(0, max);
                        if (has_caps) {
                            for (let i = 1; i <= max; i++) {
                                if (i <= cur) {
                                    embed.addField(`Player ${i}:`, players[i - 1]);
                                } else {
                                    if (!inserted) {
                                        embed.addField(`Player ${i}:`, member.toString());
                                        players.push(member.toString());
                                        inserted = true;
                                    } else {
                                        embed.addField(`Player ${i}:`, '\u200b');
                                    }
                                }
                            }
                        } else {
                            let i = 1;
                            for (i = 1; i <= cur; i++) {
                                embed.addField(`Player ${i}:`, players[i - 1]);
                            }
                            if (!inserted) {
                                embed.addField(`Player ${i}:`, member.toString());
                                players.push(member.toString());
                                inserted = true;
                            }
                        }

                        break;
                    case 0:
                        for (let field of embed.fields) {
                            if (field.value && field.value != '\u200b' && (!(field.value.indexOf(member.id) !== -1) || embed.description.indexOf(member.displayName) !== -1)) {
                                players.push(field.value);
                            }
                        }

                        embed = embed.spliceFields(0, max);
                        if (has_caps) {
                            for (let i = 1; i <= max; i++) {
                                if (i <= players.length) {
                                    embed.addField(`Player ${i}:`, players[i - 1]);
                                } else {
                                    embed.addField(`Player ${i}:`, '\u200b');
                                }
                            }
                        } else {
                            for (let i = 1; i <= players.length; i++) {
                                embed.addField(`Player ${i}:`, players[i - 1]);
                            }
                        }
                        break;
                }
                if (status && has_caps && players.length >= max) {
                    embed.setFooter('Closed. This bracket is now full.');
                }

                await message.edit({ content: message.content, embed: embed }).then(async message => {
                    // Notify join
                    if (inviter) {
                        await g_interface.dm(inviter, `${member} ${status ? 'joined' : 'left'} your bracket. ${players.length > 1 ? `${players.length} players total.` : ''}`);
                    }
                    // Notify full
                    if (status && has_caps && players.length >= max) {
                        await message.reactions.removeAll().catch(error => { });
                        if (inviter) {
                            embed.setDescription('Your team members are listed below.');
                            embed.setFooter('Game On!');
                            g_interface.dm(inviter, { content: `Your ${embed.title} bracket is now full.`, embed: embed });
                        }
                    }
                }).catch(error => {
                    g_interface.on_error({
                        name: 'beginProcess -> .edit()',
                        location: 'coordinator.js',
                        error: error
                    });
                });
            }
        });
    }
    is_processing = false;
}

// Database Module Functions
module.exports = {
    invite,
    queue
}