export default class ErrorTicket {
  /**
   * Creates an Error Ticket for the Error Manager.
   * @param {string} location The location of this module.
   * @param {string} method The name of the method that throwed the error.
   * @param {string | Object} error The error message or object.
   * @param {string} base The base method of the method that throwed the error.
   */
  constructor(location, method, error, base) {
    this.location = location;
    this.name = base ? `${base} -> ${method}` : method;
    this.error = error;
  }
}
