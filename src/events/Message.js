const Discord = require('discord.js');

/** @param {Discord.Message} message */
module.exports = async function onMessage(message) {
	// Game Invites Channel Blocking
	if (message.channel && message.channel.id == this.app.utils.constants.channels.integrations.game_invites && (message.embeds.length == 0 || (message.embeds.length > 0 && message.embeds[0].author.name != 'Quarantine Gaming: Game Coordinator'))) {
		this.sendToUser(message.author, 'Hello there! You can\'t send any messages in ' + message.channel + ' channel.').then(async reply => {
			message.delete({ timeout: 2500 }).catch(e => void e);
			reply.delete({ timeout: 2500 }).catch(e => void e);
		});
	}

	// DM
	if (message.guild == null) {
		const this_member = this.app.member(message.author);
		if (this_member && !this_member.user.bot) {
			const embed = new Discord.MessageEmbed();
			embed.setAuthor('Quarantine Gaming: Direct Message Handler');
			embed.setTitle('New Message');
			embed.setThumbnail(message.author.displayAvatarURL());
			embed.addField('Sender:', this_member);
			embed.addField('Message:', message.content);
			embed.setFooter(`To reply, do: !message dm ${this_member.user.id} <message>`);
			embed.setColor('#00ff6f');

			this.sendToChannel(this.app.utils.constants.channels.qg.dm, embed);
		}
	}
};