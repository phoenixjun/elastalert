import { spawn, spawnSync } from 'child_process';
import config from '../../common/config';
import Logger from '../../common/logger';
import { Status } from '../../common/status';
import fs from 'fs';

let logger = new Logger('ProcessController');

export default class ProcessController {

  constructor() {
    this._elastalertPath = config.get('elastalertPath');
    this._status = Status.IDLE;
    this._code = 503; //Service Not Available (yet)

    /**
     * @type {ChildProcess}
     * @private
     */
    this._process = null;
  }

  get status() {
    return this._status;
  }

  get httpCode() {
    return this._code;
  }

  /**
   * Start ElastAlert if it isn't already running.
   */
  start() {
    // Do not do anything if ElastAlert is already running
    if (this._process !== null) {
      logger.warn('ElastAlert is already running!');
      return;
    }

    // Start ElastAlert from the directory specified in the config
    logger.info('Starting ElastAlert');
    this._status = Status.STARTING;
    var stdout = fs.openSync('/dev/stdout', 'a');
    var stderr = fs.openSync('/dev/stderr', 'a');

    // Create ElastAlert index if it doesn't exist yet
    logger.info('Creating index');
    var indexCreate = spawnSync('python', ['-m', 'elastalert.create_index', '--index', 'elastalert_status', '--old-index', ''], {
      cwd: this._elastalertPath,
      stdio: ['ignore', stdout, stderr]
    });

    // Set listeners for index create exit
    if (indexCreate.status === 0) {
      logger.info(`Index create exited with code ${indexCreate.status}`);
    } else {
      logger.error(`Index create exited with code ${indexCreate.status}`);
      logger.warn('ElastAlert will start but might not be able to save its data!');
    }

    let startArguments = [];

    if (config.get('start') !== undefined && config.get('start') !== '') {
      logger.info('Setting ElastAlert query beginning to time ' + config.get('start'));
      startArguments.push('--start', config.get('start'));
    }

    if (config.get('end') !== undefined && config.get('end') !== '') {
      logger.info('Setting ElastAlert query ending to time ' + config.get('end'));
      startArguments.push('--end', config.get('end'));
    }

    if (config.get('debug') === true) {
      logger.info('Setting ElastAlert debug mode. This will increase the logging verboseness, change all alerts to DebugAlerter, which prints alerts and suppresses their normal action, and skips writing search and alert metadata back to Elasticsearch.');
      startArguments.push('--debug');
    }

    if (config.get('verbose') === true) {
      logger.info('Setting ElastAlert verbose mode. This will increase the logging verboseness, which allows you to see information about the state of queries.');
      startArguments.push('--verbose');
    }

    if (config.get('es_debug') === true) {
      logger.info('Setting ElastAlert es_debug mode. This will enable logging for all queries made to Elasticsearch.');
      startArguments.push('--es_debug');
    }

    logger.info('Starting elastalert with arguments ' + (startArguments.join(' ') || '[none]'));

    this._process = spawn('python', ['-m', 'elastalert.elastalert'].concat(startArguments), {
      cwd: this._elastalertPath,
      stdio: ['ignore', stdout, stderr]
    });

    logger.info(`Started Elastalert (PID: ${this._process.pid})`);
    this._status = Status.READY;
    this._code = 200;

    // Set listeners for ElastAlert exit
    this._process.on('exit', (code) => {
      if (code === 0) {
        logger.info(`ElastAlert exited with code ${code}`);
        this._status = Status.IDLE;
      } else {
        logger.error(`ElastAlert exited with code ${code}`);
        this._status = Status.ERROR;
        this._code = 500;
      }
      this._process = null;
    });

    // Set listener for ElastAlert error
    this._process.on('error', (err) => {
      logger.error(`ElastAlert error: ${err.toString()}`);
      this._status = Status.ERROR;
      this._code = 500;
      this._process = null;
    });
  }

  /**
   * Stop ElastAlert if it is running.
   */
  stop() {
    if (this._process !== null) {
      // Stop ElastAlert
      logger.info(`Stopping ElastAlert (PID: ${this._process.pid})`);
      this._status = Status.CLOSING;
      this._process.kill('SIGINT');
      this._code = 503; //Service Unavailable
    } else {
      // Do not do anything if ElastAlert is not running
      logger.info('ElastAlert is not running');
    }
  }
}
