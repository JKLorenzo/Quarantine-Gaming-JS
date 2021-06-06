import { Collection, MessageEmbed } from 'discord.js';
import {
  ErrorTicketManager,
  contains,
  constants,
  ProcessQueue,
} from '../utils/Base.js';

/**
 * @typedef {import('discord.js').Role} Role
 * @typedef {import('discord.js').Message} Message
 * @typedef {import('discord.js').Presence} Presence
 * @typedef {import('discord.js').Activity} Activity
 * @typedef {import('discord.js').GuildMember} GuildMember
 * @typedef {import('../structures/Base').Client} Client
 */

/**
 * @typedef {Object} ActivityData
 * @property {Activity} activity
 * @property {'OLD' | 'NEW'} status
 */

const ETM = new ErrorTicketManager('Game Manager');

export default class GameManager {
  /**
   * @param {Client} client The QG Client
   */
  constructor(client) {
    this.client = client;

    this.queuer = new ProcessQueue();
  }

  async init() {
    // Remove expired game roles
    setInterval(() => {
      this.queuer.queue(async () => {
        await this.clearExpired();
      });
    }, 3600000);

    // Delete empty play roles
    setInterval(() => {
      this.queuer.queue(async () => {
        const promises = [];
        const play_roles = this.client.qg.roles.cache.filter(
          r => r.hexColor === constants.colors.play_role,
        );

        for (const play_role of play_roles.array()) {
          if (play_role.members.size) continue;
          promises.push(this.client.role_manager.delete(play_role));
        }
        await Promise.all(promises);
      });
    }, 1800000);

    this.client.on('presenceUpdate', (oldPresence, newPresence) => {
      try {
        if (newPresence.guild.id !== constants.qg.guild) return;
        this.queuer.queue(() => {
          this.processPresenceUpdate(oldPresence, newPresence);
        });
      } catch (error) {
        this.client.error_manager.mark(ETM.create('presenceUpdate', error));
      }
    });

    this.client.on('roleCreate', async role => {
      try {
        if (role.guild.id !== constants.qg.guild) return;
        if (role.hexColor !== constants.colors.game_role) return;

        await this.client.interaction_manager.loadCommands();

        const images = await this.client.methods.fetchImage(role.name);
        await this.client.message_manager.sendToChannel(
          constants.cs.channels.game_events,
          new MessageEmbed({
            author: { name: 'Quarantine Gaming: Game Manager' },
            title: role.name,
            thumbnail: { url: images?.small },
            image: { url: images?.large },
            footer: { text: `Game Create • Reference ID: ${role.id}` },
            color: 'GREEN',
          }),
        );
      } catch (error) {
        this.client.error_manager.mark(ETM.create('roleCreate', error));
      }
    });

    this.client.on('roleDelete', async role => {
      try {
        if (role.guild.id !== constants.qg.guild) return;
        if (role.hexColor !== constants.colors.game_role) return;

        await this.client.interaction_manager.loadCommands();

        const images = await this.client.methods.fetchImage(role.name);
        await this.client.message_manager.sendToChannel(
          constants.cs.channels.game_events,
          new MessageEmbed({
            author: { name: 'Quarantine Gaming: Game Manager' },
            title: role.name,
            thumbnail: { url: images?.small },
            image: { url: images?.large },
            footer: { text: `Game Delete • Reference ID: ${role.id}` },
            color: 'RED',
          }),
        );
      } catch (error) {
        this.client.error_manager.mark(ETM.create('roleDelete', error));
      }
    });

    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      try {
        if (newMember.guild.id !== constants.qg.guild) return;
        const difference = newMember.roles.cache.difference(
          oldMember.roles.cache,
        );
        if (difference.size === 0) return;

        for (const this_role of difference.array()) {
          const isNew = newMember.roles.cache.has(this_role.id);
          if (this_role.hexColor !== constants.colors.game_role) return;
          const images = await this.client.methods.fetchImage(this_role.name);
          if (isNew) {
            // Handles manual role add by members with manage roles permissions
            await this.client.database_manager.updateMemberGameRole(
              newMember.id,
              {
                id: this_role.id,
                name: this_role.name,
              },
            );

            await this.client.message_manager.sendToChannel(
              constants.cs.channels.game_events,
              new MessageEmbed({
                author: { name: 'Quarantine Gaming: Game Manager' },
                title: this_role.name,
                thumbnail: { url: images?.small },
                description: [
                  `**User:** ${newMember.user.username}`,
                  `**Profile:** ${newMember}`,
                ].join('\n'),
                footer: {
                  text: `Game Add • Reference ID: ${newMember.id} | ${this_role.id}`,
                },
                color: 'YELLOW',
              }),
            );
          } else {
            await this.client.database_manager.deleteMemberGameRole(
              newMember.id,
              this_role.id,
            );
            await this.client.message_manager.sendToChannel(
              constants.cs.channels.game_events,
              new MessageEmbed({
                author: { name: 'Quarantine Gaming: Game Manager' },
                title: this_role.name,
                thumbnail: { url: images?.small },
                description: [
                  `**User:** ${newMember.user.username}`,
                  `**Profile:** ${newMember}`,
                ].join('\n'),
                footer: {
                  text: `Game Remove • Reference ID: ${newMember.id} | ${this_role.id}`,
                },
                color: 'FUCHSIA',
              }),
            );
          }
        }
      } catch (error) {
        this.client.error_manager.mark(ETM.create('guildMemberUpdate', error));
      }
    });

    try {
      await this.reload();

      this.client.message_manager.sendToChannel(
        constants.cs.channels.logs,
        '✅ - Game Manager',
      );
    } catch (error) {
      this.client.message_manager.sendToChannel(
        constants.cs.channels.logs,
        '❌ - Game Manager',
      );
      throw error;
    }
  }

  /**
   * Reload all the game roles and play roles of all members
   */
  async reload() {
    try {
      const members = this.client.qg.members.cache.array();

      // Add and create game roles and play roles
      let promises = [];
      for (const member of members.filter(
        this_member => !this_member.user.bot,
      )) {
        const game_activities = member.presence.activities.filter(
          activity => activity.type === 'PLAYING',
        );
        for (const game_activity of game_activities) {
          const game_name = game_activity.name.trim();
          if (this.client.database_manager.gameBlacklisted(game_name)) continue;
          if (
            !(
              game_activity.applicationID ||
              this.client.database_manager.gameWhitelisted(game_name)
            )
          ) {
            continue;
          }
          // Game Role
          const game_role =
            this.client.qg.roles.cache.find(role => role.name === game_name) ??
            (await this.client.role_manager.create({
              name: game_name,
              color: constants.colors.game_role,
            }));
          promises.push(this.client.role_manager.add(member, game_role));
          // Play Role
          const streaming_role = this.client.role(constants.qg.roles.streaming);
          const play_role =
            this.client.qg.roles.cache.find(
              role => role.name === `Play ${game_name}`,
            ) ??
            (await this.client.role_manager.create({
              name: `Play ${game_name}`,
              color: constants.colors.play_role,
              position: streaming_role.position,
              hoist: true,
            }));
          if (member.roles.cache.has(play_role.id)) continue;
          promises.push(this.client.role_manager.add(member, play_role));
        }
      }
      await Promise.all(promises);

      // Delete unused game roles
      promises = [];
      for (const game_role of this.client.qg.roles.cache
        .array()
        .filter(role => role.hexColor === constants.colors.game_role)) {
        if (
          game_role.members.array().length > 0 &&
          !this.client.database_manager.gameBlacklisted(game_role.name)
        ) {
          continue;
        }
        promises.push(this.client.role_manager.delete(game_role));
      }
      await Promise.all(promises);

      // Delete unused play roles
      promises = [];
      for (const play_role of this.client.qg.roles.cache
        .array()
        .filter(role => role.hexColor === constants.colors.play_role)) {
        const game_name = play_role.name.substring(5);
        const promises_1 = [];
        for (const member of play_role.members.array()) {
          const games_playing = member.presence.activities
            .filter(activity => activity.type === 'PLAYING')
            .map(activity => activity.name.trim());
          if (games_playing.includes(game_name)) continue;
          promises_1.push(this.client.role_manager.remove(member, play_role));
        }
        await Promise.all(promises_1);
        if (
          play_role.members.array().length > 0 &&
          this.client.qg.roles.cache.some(
            role =>
              role.hexColor === constants.colors.game_role &&
              contains(play_role.name, role.name),
          )
        ) {
          continue;
        }
        promises.push(this.client.role_manager.delete(play_role));
      }
      await Promise.all(promises);
    } catch (error) {
      this.client.error_manager.mark(ETM.create('reload', error));
    }
  }

  /**
   * @param {Presence} oldPresence The old presence data
   * @param {Presence} newPresence The new presence data
   */
  async processPresenceUpdate(oldPresence, newPresence) {
    const member = newPresence?.member ?? oldPresence?.member;

    // Disable game role add to not override member verification
    if (!member.roles.cache.has(constants.qg.roles.member)) return;

    /** @type {Collection<String, ActivityData>} */
    const oldGames = new Collection();
    /** @type {Collection<String, ActivityData>} */
    const newGames = new Collection();

    oldPresence?.activities
      .filter(activity => activity.type === 'PLAYING')
      .forEach(activity => {
        oldGames.set(activity.name.trim(), {
          activity: activity,
          status: 'OLD',
        });
      });
    newPresence?.activities
      .filter(activity => activity.type === 'PLAYING')
      .forEach(activity => {
        newGames.set(activity.name.trim(), {
          activity: activity,
          status: 'NEW',
        });
      });

    const difference = oldGames.difference(newGames);

    for (const [game_name, { activity, status }] of difference) {
      const not_blacklisted =
        !this.client.database_manager.gameBlacklisted(game_name);
      const valid =
        activity.applicationID ||
        this.client.database_manager.gameWhitelisted(game_name);
      if (not_blacklisted && valid) {
        const streaming_role = this.client.role(constants.qg.roles.streaming);
        const game_role =
          this.client.qg.roles.cache.find(role => role.name === game_name) ??
          (await this.client.role_manager.create({
            name: game_name,
            color: constants.colors.game_role,
          }));
        let play_role = this.client.qg.roles.cache.find(
          role => role.name === `Play ${game_name}`,
        );

        switch (status) {
          case 'NEW':
            if (play_role) {
              await play_role.setPosition(streaming_role.position - 1);
            } else {
              play_role = await this.client.role_manager.create({
                name: `Play ${game_name}`,
                color: constants.colors.play_role,
                position: streaming_role.position,
                hoist: true,
              });
            }
            await Promise.all([
              this.client.role_manager.add(member, game_role),
              this.client.role_manager.add(member, play_role),
            ]);
            break;
          case 'OLD':
            if (play_role && member.roles.cache.has(play_role.id)) {
              await this.client.role_manager.remove(member, play_role);
            }
            break;
        }
      }
    }
  }

  async clearExpired() {
    try {
      const members = this.client.qg.members.cache.array();
      const promises = [];
      for (const member of members) {
        if (member.user.bot) continue;
        const game_roles = member.roles.cache.filter(
          r => r.hexColor === constants.colors.game_role,
        );
        if (!game_roles?.size) continue;
        const expired_games =
          await this.client.database_manager.getMemberExpiredGameRoles(
            member.id,
          );
        if (!expired_games?.length) continue;
        for (const expired_game of expired_games) {
          if (this.client.qg.roles.cache.has(expired_game.id)) {
            promises.push(
              this.client.role_manager.remove(member, expired_game.id),
            );
          } else {
            // Handle missing roles
            await this.client.database_manager.deleteMemberGameRole(
              member.id,
              expired_game.id,
            );
          }
        }
      }
      await Promise.all(promises);
    } catch (error) {
      this.client.error_manager.mark(ETM.create('clearExpired', error));
    }
  }

  /**
   * Sends a game invite to the game invites channel.
   * @param {GuildMember} inviter The member who made the invite
   * @param {Role} game_role The game role representing the game
   * @param {InviteOptions} options The options for this invite
   * @typedef {Object} InviteOptions
   * @property {string} [description]
   * @property {number} [needed]
   * @property {GuildMember[]} [reserved]
   * @returns {Message}
   */
  async createInvite(inviter, game_role, options = {}) {
    try {
      const embed = new MessageEmbed({
        author: { name: 'Quarantine Gaming: Game Coordinator' },
        title: game_role.name,
        description:
          options.description ?? `${inviter} wants to play ${game_role}.`,
        fields: [{ name: 'Player 1', value: inviter.toString() }],
        image: { url: constants.images.multiplayer_banner },
        footer: {
          text: `Join this ${
            options.player_count ? 'limited' : 'open'
          } bracket by reacting below.`,
        },
        color: 'BLURPLE',
      });

      if (options.reserved) {
        for (const member of options.reserved) {
          if (member) {
            embed.addField(
              `Player ${embed.fields.length + 1}`,
              member.toString(),
            );
          }
        }
      }

      if (options.player_count) {
        for (let i = 0; i < options.player_count; i++) {
          if (embed.fields.length < 25) {
            embed.addField(
              `Player ${embed.fields.length + 1}`,
              'Slot Available',
            );
          }
        }
      }

      const images = await this.client.methods.fetchImage(game_role.name);
      if (images.small) embed.setThumbnail(images.small);
      if (images.large) embed.setImage(images.large);

      const invite = await this.client.message_manager.sendToChannel(
        constants.qg.channels.integrations.game_invites,
        {
          content: `${inviter} is inviting you to play ${game_role}.`,
          embed: embed,
          allowedMentions: {
            users: [],
            roles: [game_role.id],
          },
          components: this.client.interaction_manager.components
            .get('game_bracket')
            .getComponents(),
        },
      );
      invite.delete({ timeout: 1800000 });
      return invite;
    } catch (error) {
      this.client.error_manager.mark(ETM.create('createInvite', error));
    }
  }
}
