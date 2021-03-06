'use strict';

/**
 *  Logger helper, which allows keeping track of "tasks" and helps with nesting
 *  log statements
 */

const cursor = require('ansi')(process.stdout);
const newlines = require('./newlines.js');
const chalk = require('chalk');
const _ = require('lodash');
const Promise = require('bluebird');

// Internal helper for logging stuff out
function log(fn, args, indent) {
    if (args.length === 0) {
        return;
    }

    // Assumes args are something you would pass into console.log
    // Applies appropriate nesting
    const indentation = _.repeat('\t', indent);

    // Prepend tabs to first arg (if string)
    if (_.isString(args[0])) {
        args[0] = indentation + args[0];
    } else {
        args.splice(0, 0, indentation);
    }

    fn.apply(this, args);
}

/**
 *  Creating a new logger
 */
const Logger = function() {
    // A stack, latest task is the last item in the array
    this.tasks = [];
    this.currentLine = 0;

    // Keeping track of current line in the log
    // Shadow stdout.write and stderr.write
    newlines(process.stdout);
    newlines(process.stderr);
    process.stderr.on('newline', function() {
        this.currentLine++;
    }.bind(this));
    process.stdout.on('newline', function() {
        this.currentLine++;
    }.bind(this));

    // Functions to expose
    this.log = function() {
        // Similar to console.log, but nested appropriately
        const args = [].slice.call(arguments);
        log(console.log, args, this.tasks.length);
    };

    this.error = function() {
        // Similar to console.error, but nested appropriately
        const args = [].slice.call(arguments);
        log(console.error, args, this.tasks.length);
    };

    /**
     *  Task tracking, acts almost like a wrapper around Promise(func(resolve, reject))
     *  If the passed in function takes no arguments, then it is assumed to be a sync
     *  call that may throw (reject) or return a value (resolve)
     *
     *  @returns Promise that resolves/rejects as if the contents, but adds some
     *  logging logic around it
     */
    this.task = function(taskName, taskFunction) {
        const indentation = this.tasks.length;
        const lines = indentation === 0 ? 1 : 0;

        // Push a simple task object to the queue
        const task = {
            name: taskName,
            line: this.currentLine + lines,
            indentation: indentation
        };

        const introLine = `${_.repeat('\t', indentation)}${taskName}`;

        const finish = function(t, succeed, err) {
            const idx = _.findIndex(this.tasks, t);
            if (idx === -1) {
                throw new Error('Task is not part of the logger');
            }

            // Remove from tasks
            this.tasks.splice(idx, 1);

            // Create message to write, then decide where to write
            let message;
            if (succeed) {
                message = `${introLine} ${chalk.green('✔')}`;
            } else if (err) {
                message = `${introLine} ${chalk.red('✖')} ${err.message}`;
            } else {
                message = `${introLine} ${chalk.red('✖')}`;
            }

            // Simple check, if on next line of the task, append to previous line
            // otherwise add a new line
            if (this.currentLine === task.line + 1) {
                cursor.up(1).eraseLine().write(message).down(1).horizontalAbsolute(0);
            } else {
                cursor.write(message).write('\n\n');
            }
        }.bind(this);

        return new Promise(function(resolve, reject) {
            // If there are currently no tasks, add an empty line
            // (top-level or first tasks are separated by empty lines)
            if (this.tasks.length === 0) {
                cursor.write('\n');
            }

            // Print out the task name
            cursor.write(`${introLine}\n`);

            // Add to the tasks array
            this.tasks.push(task);

            if (taskFunction.length === 0) {
                // Sync task
                try {
                    const result = taskFunction();
                    finish(task, true, null);
                    resolve(result);
                } catch (err) {
                    finish(task, false, err);
                    reject(err);
                }
            } else {
                // Async task
                const res = function(value) {
                    finish(task, true, null);
                    resolve(value);
                };

                const rej = function(err) {
                    finish(task, false, err);
                    reject(err);
                };

                taskFunction(res, rej);
            }
        }.bind(this));
    };

    return this;
};

Logger.shared = new Logger();
module.exports = Logger;
