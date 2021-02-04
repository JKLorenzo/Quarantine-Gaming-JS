const Discord = require('discord.js');
const functions = require('./functions.js');
const classes = require('./classes.js');
/** @type {import('./app.js')} */
let app;

const RoleCreateDeleteManager = new classes.ProcessQueue(2500);
const RoleAddRemoveManager = new classes.ProcessQueue(2500);

/**
 * Initializes the module.
 * @param {CommandoClient} ClientInstance The Commando Client instance used to login.
 */
module.exports.initialize = (ClientInstance) => {
    // Link
    app = ClientInstance.modules.app;
}

/**
 * Creates a new role in the guild.
 * @param {{name: String, color?: Discord.ColorResolvable, hoist?: Boolean, position?: number, permissions?: Discord.PermissionResolvable, mentionable?: Boolean, reason?: String}} options 
 * @returns {Promise<Discord.Role>} A role object
 */
module.exports.create = (options) => {
    return new Promise(async (resolve, reject) => {
        console.log(`RoleCreate: Queueing ${RoleCreateDeleteManager.processID}`);
        await RoleCreateDeleteManager.queue();
        console.log(`RoleCreate: Started ${RoleCreateDeleteManager.currentID}`);
        let output, error;
        try {
            output = await app.guild().roles.create({
                data: {
                    name: options.name,
                    color: options.color,
                    hoist: options.hoist,
                    mentionable: options.mentionable,
                    permissions: options.permissions,
                    position: options.position,
                },
                reason: options.reason
            });
        } catch (err) {
            error = err;
        }
        console.log(`RoleCreate: Finished ${RoleCreateDeleteManager.currentID}`);
        RoleCreateDeleteManager.finish();
        error ? reject(error) : resolve(output)
    });
}

/**
 * Deletes a role from the guild.
 * @param {Discord.Role} role The role object to delete.
 * @param {String} reason The reason for the deletion.
 * @returns {Promise<Discord.Role>} A role object
 */
module.exports.delete = (RoleResolvable, reason = '') => {
    return new Promise(async (resolve, reject) => {
        console.log(`RoleDelete: Queueing ${RoleCreateDeleteManager.processID}`);
        await RoleCreateDeleteManager.queue();
        console.log(`RoleDelete: Started ${RoleCreateDeleteManager.currentID}`);
        let output, error = '';
        try {
            output = await app.role(RoleResolvable).delete(reason);
        } catch (err) {
            error = err;
        }
        console.log(`RoleDelete: Finished ${RoleCreateDeleteManager.currentID}`);
        RoleCreateDeleteManager.finish();
        error ? reject(error) : resolve(output)
    });
}

/**
 * Adds the role to the target user.
 * @param {Discord.UserResolvable} UserResolvable A message object, a guild member object, a user object, or a Snowflake.
 * @param {Discord.RoleResolvable} RoleResolvable A Role object or a Snowflake.
 * @returns {Promise<Discord.Role>} A role object
 */
module.exports.add = (UserResolvable, RoleResolvable) => {
    return new Promise(async (resolve, reject) => {
        console.log(`RoleAdd: Queueing ${RoleAddRemoveManager.processID} => ${UserResolvable} | ${RoleResolvable}`);
        await RoleAddRemoveManager.queue();
        console.log(`RoleAdd: Started ${RoleAddRemoveManager.currentID} => ${UserResolvable} | ${RoleResolvable}`);
        let output, error;
        try {
            output = await app.member(UserResolvable).roles.add(app.role(RoleResolvable));
        } catch (err) {
            error = err;
        }
        console.log(`RoleAdd: Finished ${RoleAddRemoveManager.currentID} => ${UserResolvable} | ${RoleResolvable}`);
        RoleAddRemoveManager.finish();
        error ? reject(error) : resolve(output)
    });
}

/**
 * Removes the role from the target user.
 * @param {Discord.UserResolvable} UserResolvable A message object, a guild member object, a user object, or a Snowflake.
 * @param {Discord.RoleResolvable} RoleResolvable A Role object or a Snowflake.
 * @returns {Promise<Discord.Role>} A role object
 */
module.exports.remove = (UserResolvable, RoleResolvable) => {
    return new Promise(async (resolve, reject) => {
        console.log(`RoleRemove: Queueing ${RoleAddRemoveManager.processID} => ${UserResolvable} | ${RoleResolvable}`);
        await RoleAddRemoveManager.queue();
        console.log(`RoleRemove: Started ${RoleAddRemoveManager.currentID} => ${UserResolvable} | ${RoleResolvable}`);
        let output, error;
        try {
            output = await app.member(UserResolvable).roles.remove(app.role(RoleResolvable));
        } catch (err) {
            error = err;
        }
        console.log(`RoleRemove: Finished ${RoleAddRemoveManager.currentID} => ${UserResolvable} | ${RoleResolvable}`);
        RoleAddRemoveManager.finish();
        error ? reject(error) : resolve(output)
    });
}