/**
 * A Role Object represented on the database.
 */
class ParitalRole {
	/**
     * Initializes this role.
	 * @param {{id: String, name: String, lastUpdated: String}} options
     */
	constructor(options) {
		this.id = options.id;
		this.name = options.name;
		this.lastUpdated = options.lastUpdated;
	}
}

module.exports = ParitalRole;