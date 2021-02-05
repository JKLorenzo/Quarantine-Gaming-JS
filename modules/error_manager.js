const Discord = require('discord.js');
const constants = require('./constants.js');
const classes = require('./classes.js');
/** @type {import('./app.js')} */
let app;
/** @type {import('./message_manager.js')} */
let message_manager;

const MarkManager = new classes.ProcessQueue(1000);
let threshold_hit_count = 0;
let threshold_reached = false;
/** @type {Array<classes.ErrorTicket>} */
let errors_per_minute = new Array();

/**
 * Initializes the module.
 * @param {CommandoClient} ClientInstance The Commando Client instance used to login.
 */
module.exports.initialize = (ClientInstance) => {
    // Link
    app = ClientInstance.modules.app;
    message_manager = ClientInstance.modules.message_manager;
}

/**
 *  Marks the error and documents it.
 * @param {classes.ErrorTicket} ErrorTicket The Error Ticket that was generated by the Error Ticket Manager.
 */
module.exports.mark = async (ErrorTicket) => {
    await MarkManager.queue();
    if (app.isInitialized()) {
        try {
            console.error(`ErrorManager Processing: ${ErrorTicket.location} / ${ErrorTicket.name} - ${ErrorTicket.error}`);

            errors_per_minute.push(ErrorTicket);
            setTimeout(() => {
                errors_per_minute.shift();
                if (errors_per_minute.length == 0) threshold_reached = false;
            }, 60000);

            const epm = errors_per_minute.length;

            if (!threshold_reached) {
                const embed = new Discord.MessageEmbed();
                embed.setAuthor('Quarantine Gaming: Telemetry');
                embed.setTitle('Exception Details');
                if (ErrorTicket.name) {
                    embed.addField('Function', ErrorTicket.name);
                }
                if (ErrorTicket.error) {
                    embed.addField('Message', ErrorTicket.error);
                }
                if (ErrorTicket.location) {
                    embed.addField('Location', ErrorTicket.location);
                }
                if (ErrorTicket.error.code) {
                    embed.addField('Code', ErrorTicket.error.code);
                }
                embed.addField('Errors per Minute', epm);
                embed.addField('Threshold Hit', threshold_reached ? 'True' : 'False');
                embed.addField('Threshold Hit Count', threshold_hit_count);
                embed.setThumbnail('https://mir-s3-cdn-cf.behance.net/project_modules/disp/c9955d46715833.589222657aded.png');
                embed.setColor('#FF0000');
                await message_manager.sendToChannel(constants.channels.qg.logs, embed);
            }

            if ((epm > 5 || (ErrorTicket.error.code != null && ErrorTicket.error.code == '500')) && !threshold_reached) {
                // Change bot presence
                await app.setActivity(`SERVER RESTART (${++threshold_hit_count})`, 'WATCHING');

                // Announce
                await message_manager.sendToChannel(constants.channels.server.announcements, `**Discord Status Updates**\nDiscord is currently having some issues and may impact users on this server. Visit <https://discordstatus.com/> for more info.`).catch(async () => {
                    const embed = new Discord.MessageEmbed();
                    embed.setAuthor('Limited Functionality');
                    embed.setTitle('Discord Status Updates');
                    embed.setDescription(`Discord is currently having some issues and may impact users on this server. Visit <https://discordstatus.com/> for more info.`);
                    embed.setColor('ffe300');
                    await message_manager.sendToChannel(constants.channels.server.announcements, embed);
                });

                // Notify staffs
                await message_manager.sendToChannel(constants.channels.server.management, `I'm currently detecting issues with Discord; some functionalities are disabled. A bot restart is recommended once the issues are resolved.`).catch(async () => {
                    const embed = new Discord.MessageEmbed();
                    embed.setAuthor('Limited Functionality');
                    embed.setTitle('Issues with Discord');
                    embed.setDescription(`I'm currently detecting issues with Discord; some functionalities are disabled. A bot restart is recommended once the issues are resolved.`);
                    embed.setColor('ffe300');
                    await message_manager.sendToChannel(constants.channels.server.management, embed);
                });
                threshold_reached = true;
            }
        } catch (error) {
            console.error(`ErrorManager Failed: ${error}`);
        }
    } else {
        console.error(`ErrorManager Error before App Init: ${ErrorTicket.location} / ${ErrorTicket.name} - ${ErrorTicket.error}`);
    }
    MarkManager.finish();
}