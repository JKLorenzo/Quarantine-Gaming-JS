// eslint-disable-next-line no-unused-vars
const Discord = require('discord.js');
// eslint-disable-next-line no-unused-vars
const { PartialMember, PartialRole } = require('../types/Base.js');

class ExtendedMember extends Discord.GuildMember {
	/**
	 * Extends a GuildMember Object
	 * @param {Discord.Client} client
	 * @param {Object} data
	 * @param {Discord.Guild} guild
	 */
	constructor(client, data, guild) {
		super(client, data, guild);
		this.app = null;
		/** @private */
		this.memberDocRef = null;
		/** @private */
		this.memberDocSnap = null;
		/** @private */
		this.roleColRef = null;

		/**
		 * The inviter of this member.
		 * @type {PartialMember}
		 * @readonly
		 */
		this.inviter = null;
		/**
		 * The moderator that approved this member.
		 * @type {PartialMember}
		 * @readonly
		 */
		this.moderator = null;
	}

	/**
	 * Initializes this member and syncing it with the database
	 * @param {import('../app.js')} app
	 */
	async init(app) {
		this.app = app;

		let data = app.database_manager.getMemberData(super.id);
		if (!data) {
			data = await app.database_manager.setMemberData({
				id: super.id,
				name: super.displayName,
				tagname: super.user.tag,
			});
		}
		this.inviter = data.inviter;
		this.moderator = data.moderator;
	}

	/**
	 * Sets the inviter of this member.
	 * @param {Discord.GuildMember} member
	 * @param {Discord.GuildMember} moderator
	 */
	async setInviter(member, moderator) {
		await this.app.database_manager.updateMemberData(super.id, {
			inviter: member.id,
			moderator: moderator.id,
		});
		this.inviter = member.id;
		this.moderator = moderator.id;
	}

	/**
	 * Update this member's game role.
	 * @param {Discord.Role} role
	 */
	async updateGameRole(role) {
		await this.app.database_manager.updateMemberGameRole(super.id, {
			id: role.id,
			name: role.name,
		});
		await this.app.role_manager.add(super.id, role);
	}

	/**
	 * Delete this member's game role;
	 * @param {String} role_id
	 */
	async deleteGameRole(role_id) {
		await this.app.database_manager.deleteMemberGameRole(super.id, role_id);
		await this.app.role_manager.remove(super.id, role_id);
	}

	/**
	 * Gets the expired game roles of this member.
	 * @returns {Promise<PartialRole[]>}
	 */
	async getExpiredGameRole() {
		if (super.roles.cache.array().filter(role => role.hexColor = this.app.utils.constants.colors.game_role).length > 0) return new Array();
		return await this.app.database_manager.getMemberExpiredGameRoles(super.id);
	}

	/**
	 * Checks if this member has one of these roles.
 	 * @param {Discord.RoleResolvable | Discord.RoleResolvable[]} role
 	 */
	hasRole(role) {
		if (!this.exists) throw new Error('Member not initialized.');
		/** @type {String[]} */
		const roleIDs = new Array();
		if (role instanceof Array) {
			for (const this_roleresolvable of role) {
				const this_role = this.app.role(this_roleresolvable);
				if (this_role) roleIDs.push(this_role.id);
			}
		}
		else {
			const this_role = this.app.role(role);
			if (this_role) roleIDs.push(this_role.id);
		}
		for (const roleID of roleIDs) {
			if (super.roles.cache.has(roleID)) return true;
		}
		return false;
	}
}

module.exports = ExtendedMember;