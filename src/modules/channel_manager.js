const Discord = require('discord.js');
const functions = require('./functions.js');
const classes = require('./classes.js');
/** @type {import('./app.js')} */
let app;

const ChannelCreateManager = new classes.ProcessQueue(5000);
const ChannelDeleteManager = new classes.ProcessQueue(1000);

/**
 * Initializes the module.
 * @param {Function} ModulesFunction The GlobalModules function.
 */
module.exports.initialize = (ModulesFunction) => {
    // Link
    const Modules = functions.parseModules(ModulesFunction);
    app = Modules.app;
}

/**
 * Creates a new channel in the guild.
 * @param {{name: String, bitrate?: Number, nsfw?: Boolean, parent?: Discord.ChannelResolvable, permissionOverwrites?: Array<Discord.OverwriteResolvable> | Discord.Collection<String, Discord.OverwriteResolvable>, position?: Number, rateLimitPerUser?: Number, reason?: String, topic?: String, type: "text" | "voice" | "category", userLimit?: Number}} options
 * @returns {Promise<Discord.GuildChannel>} A Text Channel, a Voice Channel, or a Category Channel Object
 */
module.exports.create = (options) => {
    return new Promise(async (resolve, reject) => {
        console.log(`ChannelCreate: Queueing ${ChannelCreateManager.processID + 1}`);
        await ChannelCreateManager.queue();
        console.log(`ChannelCreate: Started ${ChannelCreateManager.processID}`);
        let output, error;
        try {
            output = await app.guild().channels.create(options.name, {
                bitrate: options.bitrate,
                nsfw: options.nsfw,
                parent: options.parent,
                permissionOverwrites: options.permissionOverwrites,
                position: options.position,
                rateLimitPerUser: options.rateLimitPerUser,
                reason: options.reason,
                topic: options.topic,
                type: options.type,
                userLimit: options.userLimit
            });
        } catch (err) {
            error = err;
        }
        console.log(`ChannelCreate: Finished ${ChannelCreateManager.processID}`);
        ChannelCreateManager.finish();
        error ? reject(error) : resolve(output)
    });
}

/**
 * Deletes a Guild Channel.
 * @param {Discord.GuildChannelResolvable} GuildChannelResolvable A GuildChannel Object or a Snowflake.
 * @param {String} reason Reason for deleting this channel.
 * @returns {Promise<Discord.Channel>} A Channel Object
 */
module.exports.delete = (GuildChannelResolvable, reason = '') => {
    return new Promise(async (resolve, reject) => {
        console.log(`ChannelDelete: Queueing ${ChannelDeleteManager.processID + 1}`);
        await ChannelDeleteManager.queue();
        console.log(`ChannelDelete: Started ${ChannelDeleteManager.processID}`);
        let output, error = '';
        try {
            output = await app.channel(GuildChannelResolvable).delete(reason);
        } catch (err) {
            error = err;
        }
        console.log(`ChannelDelete: Finished ${ChannelDeleteManager.processID}`);
        ChannelDeleteManager.finish();
        error ? reject(error) : resolve(output)
    });
}

/**
 * Deletes the messages from these channels.
 * @param {Array<Discord.GuildChannelResolvable>} GuildChannelResolvables An array of GuildChannelResolvable
 */
module.exports.clearTempChannels = async (GuildChannelResolvables) => {
    for (const channel of GuildChannelResolvables) {
        /** @type {Discord.TextChannel} */
        const this_channel = app.channel(channel);
        if (!this_channel) continue;
        await this_channel.messages.fetch().then(async messages => {
            for (const message of messages) {
                await message[1].delete({ timeout: 900000 }).catch(() => { }); // Delete after 15 mins
                await functions.sleep(5000); // Rate Limit
            }
        });
        await functions.sleep(5000); // Rate Limit
    }
}