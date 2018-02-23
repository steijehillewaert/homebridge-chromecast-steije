const mdns = require('mdns');
const CastClient = require('castv2-client').Client;
const CastDefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const CustomCharacteristics = require('./custom-characteristics');

let Service;
let Characteristic;

const mdnsSequence = [
  mdns.rst.DNSServiceResolve(),
  'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({ families: [0] }),
  mdns.rst.makeAddressesUnique(),
];

class AutomationChromecast {
  constructor(log, config) {
    this.log = log;
    this.name = config.name;
    this.chromecastDeviceName = config.chromecastDeviceName;
    this.switchOffDelay = config.switchOffDelay || 0;

    this.setDefaultProperties();

    this.switchService = new Service.Switch(this.name);
    this.switchService
      .getCharacteristic(Characteristic.On)
      .on('get', this.isCasting.bind(this))
      .on('set', this.setCasting.bind(this));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceType)
      .on('get', callback => callback(null, this.deviceType));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceIp)
      .on('get', callback => callback(null, this.deviceIp));

    this.switchService
      .addCharacteristic(CustomCharacteristics.DeviceId)
      .on('get', callback => callback(null, this.deviceId));


    this.motionService = new Service.MotionSensor(`${this.name} Streaming`);

    this.motionService
      .getCharacteristic(Characteristic.MotionDetected)
      .on('get', this.isCasting.bind(this));

    this.detectDevice();
  }

  setDefaultProperties() {
    this.chromecastIp = null;
    this.chromecastPort = null;
    this.chromecastClient = null;

    this.isCastingStatus = false;
    this.castingApplication = null;
    this.castingMedia = null;

    this.deviceType = null;
    this.deviceIp = null;
    this.deviceId = null;

    this.switchOffDelayTimer = null;
  }

  /**
   * Use bonjour to detect Chromecast devices on the network
   */
  detectDevice() {
    const browser = mdns.createBrowser(mdns.tcp('googlecast'), { resolverSequence: mdnsSequence });

    browser.on('serviceUp', (device) => {
      const txt = device.txtRecord;
      const name = txt.fn;

      if (name.toLowerCase() === this.chromecastDeviceName.toLowerCase()) {
        this.setDefaultProperties();

        const ipAddress = device.addresses[0];
        const { port } = device;

        this.chromecastIp = ipAddress;
        this.chromecastPort = port;

        this.deviceType = txt.md || '';
        this.deviceIp = `${ipAddress}:${port}`;
        this.deviceId = txt.id;

        this.log(`Chromecast found on ${this.chromecastIp}. Connecting...`);

        this.initConnection();
      }
    });

    this.log(`Scanning for Chromecast device with name "${this.chromecastDeviceName}"`);
    browser.start();
  }

  deviceTimeout() {
    this.log('Chromecast connection: timeout');
    if (this.chromecastClient && this.chromecastClient.connection) {
      this.chromecastClient.connection.disconnect();
      this.deviceDisconnected();
    }
  }

  deviceDisconnected() {
    this.log('Chromecast connection: disconnected');

    this.setIsCasting(false);
    this.setDefaultProperties();
  }

  initConnection() {
    this.chromecastClient = new CastClient();

    const connectionDetails = {
      host: this.chromecastIp,
      port: this.chromecastPort,
    };

    this.chromecastClient
      .on('status', this.processClientStatus.bind(this))
      .on('timeout', () => this.deviceTimeout())
      .on('error', (status) => {
        this.log('Client error:');
        this.log(status);
      });

    this.chromecastClient.connect(connectionDetails, () => {
      if (
        this.chromecastClient.connection &&
        this.chromecastClient.heartbeat &&
        this.chromecastClient.receiver
      ) {
        this.log('Chromecast connection: connected');

        this.chromecastClient.connection
          .on('timeout', () => this.deviceTimeout())
          .on('disconnect', () => this.deviceDisconnected());

        this.chromecastClient.heartbeat
          .on('timeout', () => this.deviceTimeout())
          .on('pong', () => null);

        this.chromecastClient.receiver
          .on('status', this.processClientStatus.bind(this));

        // Force to detect the current status in order to initialise processClientStatus() at boot
        this.chromecastClient.getStatus((err, status) => this.processClientStatus(status));
      }
    });
  }

  processClientStatus(status) {
    // this.log.debug('Received client status:');
    // this.log.debug(status);

    const { applications } = status;
    const currentApplication = applications && applications.length > 0 ? applications[0] : null;

    if (currentApplication) {
      const lastMonitoredApplicationStatusId =
        this.castingApplication ? this.castingApplication.sessionId : null;

      if (currentApplication.sessionId !== lastMonitoredApplicationStatusId) {
        this.castingApplication = currentApplication;

        /*
        NOTE: The castv2-client library has not been updated in a while.
        The current version of Chromecast protocol may NOT include transportId when streaming
        to a group of speakers. The transportId is same as the sessionId.
        Assigning the transportId to the sessionId makes the library works with
        group of speakers in Chromecast Audio.
         */
        this.castingApplication.transportId = this.castingApplication.sessionId;

        try {
          this.chromecastClient.join(
            this.castingApplication,
            CastDefaultMediaReceiver,
            (_, media) => {
              // this.log('New media');
              // Force to detect the current status in order to initialise at boot
              media.getStatus((err, mediaStatus) => this.processMediaStatus(mediaStatus));
              media.on('status', this.processMediaStatus.bind(this));
              this.castingMedia = media;
            },
          );
        } catch (e) {
          this.deviceTimeout();
          this.initConnection();
        }
      }
    } else {
      this.castingMedia = null;
      // this.log.debug('Reset media');
    }

    // Process "Stop casting" command
    if (typeof status.applications === 'undefined') {
      // this.log.debug('Stopped casting');
      this.setIsCasting(false);
    }
  }

  processMediaStatus(status) {
    // this.log.debug('Received media status:');
    // this.log.debug(status);

    if (status && status.playerState) {
      if (status.playerState === 'PLAYING' || status.playerState === 'BUFFERING') {
        this.setIsCasting(true);
      } else {
        this.setIsCasting(false);
      }
    }
  }


  setIsCasting(statusBool) {
    // Update the internal state and log only if there's been a change of state
    if (statusBool !== this.isCastingStatus) {
      if (statusBool) {
        this.log('Chromecast is now playing');
        this.isCastingStatus = true;
      } else {
        this.log('Chromecast is now stopped');
        this.isCastingStatus = false;
      }

      this.switchService.setCharacteristic(Characteristic.On, this.isCastingStatus);

      const updateMotionSensor = () => {
        this.motionService.setCharacteristic(Characteristic.MotionDetected, this.isCastingStatus);
        this.log(`Motion sensor ${this.isCastingStatus ? 'is detecting movements' : 'stopped detecting movements'}`);
      };

      if (!this.isCastingStatus && this.switchOffDelay) {
        this.switchOffDelayTimer = setTimeout(updateMotionSensor, this.switchOffDelay);
      } else {
        if (this.switchOffDelayTimer) {
          clearTimeout(this.switchOffDelayTimer);
        }
        updateMotionSensor();
      }
    }
  }

  getServices() {
    return [this.switchService, this.motionService];
  }

  /**
   * Is the Chromecast currently receiving an audio/video stream?
   *
   * @param {function} callback
   */
  isCasting(callback) {
    callback(null, this.isCastingStatus);
  }

  /**
   * Start/stop the Chromecast from receiving an audio/video stream
   *
   * @param {boolean} on
   * @param {function} callback
   */
  setCasting(on, callback) {
    const currentlyCasting = this.isCastingStatus;
    this.setIsCasting(on);

    // this.log('New status: ', on, 'Current status', currentlyCasting);

    if (!this.castingMedia) {
      callback();
      return;
    }

    if (on && !currentlyCasting) {
      // this.log('Turning on');
      this.castingMedia.play(() => callback());
    } else if (!on && currentlyCasting) {
      // this.log('Turning off');
      this.castingMedia.stop(() => callback());
    }
  }
}

module.exports = (homebridge) => {
  Service = homebridge.hap.Service; // eslint-disable-line
  Characteristic = homebridge.hap.Characteristic; // eslint-disable-line

  homebridge.registerAccessory('homebridge-automation-chromecast', 'AutomationChromecast', AutomationChromecast);
};
