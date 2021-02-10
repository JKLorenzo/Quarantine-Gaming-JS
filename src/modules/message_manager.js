const Discord = require('discord.js');
const constants = require('./constants.js');
const functions = require('./functions.js');
const classes = require('./classes.js');
/** @type {import('./app.js')} */
let app;
/** @type {import('./error_manager.js')} */
let error_manager;

const ErrorTicketManager = new classes.ErrorTicketManager('message_manager.js');
const OutgoingMessageManager = new classes.ProcessQueue(2500);

/**
 * Initializes the module.
 * @param {CommandoClient} ClientInstance The Commando Client instance used to login.
 */
module.exports.initialize = (ClientInstance) => {
	// Link
	app = ClientInstance.modules.app;
	error_manager = ClientInstance.modules.error_manager;
};

/**
 * Sends a message to a channel with respect to the messaging queue.
 * @param {Discord.GuildChannelResolvable} GuildChannelResolvable A GuildChannel object or a Snowflake.
 * @param {any} content The content of the message.
 * @returns {Promise<Discord.Message | Array<Discord.Message>>} A message object or an array of message objects
 */
module.exports.sendToChannel = (GuildChannelResolvable, content) => {
	return new Promise((resolve, reject) => {
		/** @type {Discord.TextChannel} */
		const channel = app.channel(GuildChannelResolvable);
		console.log(`MessageChannelSend: Queueing ${OutgoingMessageManager.processID} (${channel ? channel.name : GuildChannelResolvable})`);
		OutgoingMessageManager.queue().then(async () => {
			let output, error;
			try {
				output = await channel.send(content);
			}
			catch (err) {
				error = err;
			}
			console.log(`MessageChannelSend: Finished ${OutgoingMessageManager.currentID} (${channel ? channel.name : GuildChannelResolvable})`);
			OutgoingMessageManager.finish();
			error ? reject(error) : resolve(output);
		});
	});
};

/**
 * Sends a message to a user with respect to the messaging queue.
 * @param {Discord.UserResolvable} UserResolvable A message object, a guild member object, a user object, or a Snowflake.
 * @param {any} content The content of the message.
 * @returns {Promise<Discord.Message> | Array<Discord.Message>>} A message object or an array of message objects
 */
module.exports.sendToUser = (UserResolvable, content) => {
	return new Promise((resolve, reject) => {
		const member = app.member(UserResolvable);
		console.log(`MessageUserSend: Queueing ${OutgoingMessageManager.processID} (${member ? member.displayName : UserResolvable})`);
		OutgoingMessageManager.queue().then(async () => {
			let output, error;
			try {
				const channel = await member.createDM();
				output = await channel.send(content);
				output.delete({ timeout: 3600000 }).catch(e => void e);
			}
			catch (err) {
				error = err;
			}
			console.log(`MessageUserSend: Finished ${OutgoingMessageManager.currentID} (${member ? member.displayName : UserResolvable})`);
			OutgoingMessageManager.finish();
			error ? reject(error) : resolve(output);
		});
	});
};

/**
 * Processes all incoming messages.
 * @param {Discord.Message} message The message object.
 */
module.exports.process = async (message) => {
	try {
		// Help
		if (message.channel && message.content.toLowerCase() == '!help') {
			await functions.sleep(1000);
			await message.channel.send('Visit <https://quarantinegamingdiscord.wordpress.com/> to learn more.');
		}

		// Game Invites Channel Blocking
		if (message.channel && message.channel.id == constants.channels.integrations.game_invites && (message.embeds.length == 0 || (message.embeds.length > 0 && message.embeds[0].author.name != 'Quarantine Gaming: Game Coordinator'))) {
			await this.sendToUser(message.author, 'Hello there! You can\'t send any messages in ' + message.channel + ' channel.');
			await message.delete({ timeout: 2500 }).catch(e => void e);
		}

		// DM
		if (message.guild == null) {
			const this_member = app.member(message.author);
			if (this_member && !this_member.user.bot) {
				const embed = new Discord.MessageEmbed();
				embed.setAuthor('Quarantine Gaming: Direct Message Handler');
				embed.setTitle('New Message');
				embed.setThumbnail(message.author.displayAvatarURL());
				embed.addField('Sender:', this_member);
				embed.addField('Message:', message.content);
				embed.setFooter(`To reply, do: !message dm ${this_member.user.id} <message>`);
				embed.setColor('#00ff6f');

				await this.sendToChannel(constants.channels.qg.dm, embed);
			}
		}
	}
	catch (error) {
		error_manager.mark(ErrorTicketManager.create('incoming', error));
	}
};