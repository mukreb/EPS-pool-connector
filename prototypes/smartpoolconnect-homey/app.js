'use strict';

const Homey = require('homey');

class SmartPoolConnectApp extends Homey.App {
  async onInit() {
    this.log('Smart Pool Connect app initialised');
  }
}

module.exports = SmartPoolConnectApp;
