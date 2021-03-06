#!/usr/bin/env node
// Handle EPIPE errors when user doesn't put quotes around output file name with parameters
function epipeError(err) {
  if (err.code === 'EPIPE' || err.errno === 32) return process.exit;

  if (process.stdout.listeners('error').length <= 1) {
    process.stdout.removeAllListeners();
    process.stdout.emit('error', err);
    process.stdout.on('error', epipeError);
  }
}

process.stdout.on('error', epipeError);

const chalk = require('chalk');
const fs = require('fs-extra');
const rename = require('./rename');
const opn = require('opn');
const os = require('os');
const path = require('path');
const readlineSync = require('readline-sync');
const yargs = require('yargs');

const argv = yargs
    .usage('Rename-CLI v' + require('./package.json').version + '\n\nUsage:\n\n  rename [options] file(s) new-file-name')
    .options(require('./lib/yargsOptions'))
    .help('help')
    .epilogue('Variables:\n\n' + rename.getVariableList())// + rename.getReplacementsList())
    .wrap(yargs.terminalWidth())
    .argv;

const compiled = (argv['$0'] && argv['$0'].indexOf('rname.exe') > -1);

// create ~/.rename/userData.js if not exist
const userData = os.homedir() + '/.rename/userData.js';
fs.ensureFile(userData, err => {
  if (err) throw err;
  fs.readFile(userData, 'utf8', (er, data) => {
    if (er) throw er;
    if (data === '') {
      fs.readFile(__dirname + '/lib/userData.js', 'utf8', (ex, text) => {
        if (ex) throw ex;
        fs.writeFile(userData, text, (e) => {
          if (e) throw e;
        });
      });
    }
  });
});

// create ~/.rename/userFilters.js if not exist
const userFilters = os.homedir() + '/.rename/userFilters.js';
fs.ensureFile(userFilters, err => {
  if (err) throw err;
  fs.readFile(userFilters, 'utf8', (er, data) => {
    if (er) throw er;
    if (data === '') {
      fs.readFile(__dirname + '/lib/userFilters.js', 'utf8', (ex, text) => {
        if (ex) throw ex;
        fs.writeFile(userFilters, text, (e) => {
          if (e) throw e;
          parseArgs();
        });
      });
    } else {
      parseArgs();
    }
  });
});

function parseArgs() {
  if (argv.i) { // view online hlep
    opn('https://github.com/jhotmann/node-rename-cli');
    if (process.platform !== 'win32') {
      process.exit(0);
    }
  } else if (argv.u) { // undo previous rename
    rename.undoRename();
  } else if (argv.w) { // launch the wizard
    require('./lib/wizard')();
  } else if (argv.printdata) {
    let file = argv._.pop();
    let options = rename.argvToOptions(argv);
    rename.printData(file, options);
  } else if (argv._.length > 1) { // proceed to do the rename
    renameFiles();
  } else if (argv._.length === 0 && !compiled) {
    require('./lib/ui');
  } else {
    console.log('ERROR: Not enough arguments specified. Type rename -h for help');
    process.exit(1);
  }
}

function renameFiles() {
  let newFileName = path.parse(argv._.pop());
  let files = rename.getFileArray(argv._).map(f => { return f.replace(/\\\[/g, '[').replace(/\\\]/g, ']'); });
  let options = rename.argvToOptions(argv);
  if (argv.nomove && argv.createdirs) console.log(chalk.yellow('WARNING: You passed both the --nomove and --createdirs options, --createdirs will be ignored'));
  let operations;
  try {
    operations = rename.getOperations(files, newFileName, options);
  } catch (e) {
    console.dir(e); //TODO remove when done debugging
    if (typeof e === 'string' && e.startsWith('Template render error')) {
      let actualError = e.split('\n').length > 1 ? e.split('\n')[1].trim() : e;
      let helpfulText = e.split('\n').length > 2 ? e.split('\n')[2].trim() : '';
      console.log(chalk.red('Error generating output file name: ') + actualError);
      let match = e.match('Line 1, Column (\\d+)');
      if (match && helpfulText) {
        let charNum = parseInt(match[1]) - 1;
        console.log(helpfulText.substring(0,charNum) + chalk.red(helpfulText.charAt(charNum)) + helpfulText.substring(charNum + 1));
      }
    } else {
      console.log(chalk.red("Error: " + e));
    }
    process.exit(1);
  }
  let hasConflicts = rename.hasConflicts(operations);
  let hasMissingDirectories = rename.hasMissingDirectories(operations);
  
  // Warn if any replacement variables are being deprecated
  let deprecationMessages = [];
  operations.filter(o => { return o.deprecationMessages; }).forEach(o => { o.deprecationMessages.forEach(m => { if (deprecationMessages.indexOf(m) === -1) deprecationMessages.push(m); }); });
  if (deprecationMessages && deprecationMessages.length > 0) deprecationMessages.forEach(m => { console.log(chalk.yellow(m)); });
  
  // Print off renames if simulated, or prompt options used, or warn if there are file
  // conflicts and the force option isn't used.
  if (options.simulate || options.prompt || (!options.force && !options.keep && hasConflicts) || (!options.force && !options.createDirs && hasMissingDirectories)) {
    let conflicts = false;
    let existing = false;
    let missingDirectories = false;
    let missingDirectoryPaths = [];
    console.log('');
    if (operations.length === 0 && options.verbose) {
      console.log('No rename operations to execute');
    }
    operations.forEach(function(value) {
      if (value.alreadyExists) {
        console.log(chalk.red(value.text));
        existing = true;
      } else if (value.conflict) {
        console.log(chalk.yellow(value.text));
        conflicts = true;
      } else if (!value.directoryExists) {
        if (options.force || options.createDirs) {
          console.log(chalk.yellow(value.text));
        } else {
          console.log(chalk.red(value.text));
          missingDirectories = true;
        }
        missingDirectoryPaths.push(value.missingDirectory);
      } else {
        console.log(value.text);
      }
    });
    if (existing || conflicts || missingDirectories || (options.verbose && hasMissingDirectories)) {
      console.log('');
    }
    if (existing) {
      console.log(chalk.red('WARNING: File(s) already exist'));
      if (!options.simulate && !options.force) {
        console.log('');
      }
    }
    if (conflicts) {
      console.log(chalk.yellow('WARNING: There are conflicting output file name(s)'));
      if (!options.simulate && !options.force) {
        console.log('');
      }
    }
    if (missingDirectories && !options.createDirs && !options.force) {
      missingDirectoryPaths.filter(onlyUnique).forEach(p => console.log(chalk.red(`WARNING: The directory ${p} doesn't exist`)));
      if (!options.simulate && !options.force) {
        console.log('');
      }
    }
    if (hasMissingDirectories && (options.createDirs || options.force)) {
      missingDirectoryPaths.filter(onlyUnique).forEach(p => console.log(chalk.yellow(`NOTE: The directory ${p} will be created`)));
      if (!options.simulate && !options.force) {
        console.log('');
      }
    }
    if (!options.simulate && (existing || conflicts || missingDirectories || options.verbose || options.prompt)) {
      if (!hasConflicts && !missingDirectories) {
        console.log('');
      }
      if (readlineSync.keyInYN('Would you like to proceed?')) {
        rename.run(operations, options);
      }
    }
  } else {
    rename.run(operations, options);
  }
}

function onlyUnique(value, index, self) { 
  return self.indexOf(value) === index;
}