import { MessageEmbed } from 'discord.js';
import { constants } from '../utils/Base.js';

/**
 * @typedef {import('discord.js').User} User
 * @typedef {import('../structures/Base').Client} Client
 */

/**
 * @param {Client} client
 * @param {User} oldUser
 * @param {User} newUser
 */
export default async function onUserUpdate(client, oldUser, newUser) {
	const member = client.member(newUser);

	const description = [`**Profile:** ${member}`];
	if (oldUser.username != newUser.username) description.push(`**Username:** \nOld: ${oldUser.username} \nNew: ${newUser.username}`);
	if (oldUser.tag != newUser.tag) description.push(`**Tagname:** \nOld: ${oldUser.tag} \nNew: ${newUser.tag}`);
	if (oldUser.displayAvatarURL() != newUser.displayAvatarURL()) description.push(`**Avatar:** [New Avatar](${newUser.displayAvatarURL()})`);

	if (description.length > 1) {
		client.message_manager.sendToChannel(constants.interface.channels.member_events, new MessageEmbed({
			author: { name: member.displayName, icon_url: member.displayAvatarURL() },
			description: description.join('\n'),
			footer: { text: `Reference ID: ${member.id}` },
			color: 'BLURPLE',
		}));
	}
}