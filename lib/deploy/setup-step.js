"use strict";

require('../helpers/string-additions');

const AWS = require('aws-sdk');
const cp = require('child_process');
const fsx = require('../helpers/fs-additions');
const path = require('path');
const Promise = require('bluebird');
const _ = require('lodash');

//
// Setup step for populating the context and doing some preliminary checks
//
module.exports = function(context) {
    return Promise.all([
        checkAvailability('aws'),
        checkAvailability('java'),
        prepareStagingDirectory(context),
        listLambdas(context)
    ]).then(function (results) {
        const newContext = _.assign({}, context);

        newContext.directories.staging = results[2];
        newContext.lambdas = results[3];

        return newContext;
    }).then(createS3Bucket);
};

// Helpers

function checkAvailability(command) {
    return new Promise(function(resolve, reject) {
        cp.exec(`command -v ${command}`, function(error, stdout) {
            if (error !== null) {
                return reject(error);
            }

            resolve(stdout.toString());
        });
    });
}

function prepareStagingDirectory(context) {
    return new Promise(function(resolve, reject) {
        const stagingDirectory = path.resolve(context.directories.root, 'lambda_stage');
        try {
            fsx.recreateDirectory(stagingDirectory);
        } catch (error) {
            return reject(error);
        }

        resolve(stagingDirectory);
    });
}

function createS3Bucket(context) {
    const bucket = `lambdas-${context.project.name}-${context.project.stage}`;

    return new Promise(function(resolve, reject) {
        process.stdout.write(`\nMaking sure S3 bucket '${bucket}' exists`);

        const S3 = new AWS.S3({apiVersion: '2006-03-01'});
        S3.createBucket({
            Bucket: bucket
        }).send(function(err, result) {
            if (err) {
                console.log(' ✖'.red);
                return reject(err);
            }

            const ctx = _.clone(context);
            ctx.project.bucket = bucket;

            console.log(' ✔'.green);
            resolve(ctx);
        });
    });
}

function listLambdas(context) {
    return new Promise(function(resolve, reject) {
        // Check if Lambdas directory exists
        const lambdasDirectory = path.resolve(context.directories.cwd, 'lambdas');
        if (!fsx.directoryExists(lambdasDirectory)) {
            return reject(new Error('Lambdas directory does not exist'));
        }

        // Parse the contents into the context
        const lambdaPaths = fsx.getDirectories(lambdasDirectory);
        const lambdas = lambdaPaths.map(function(lambdaPath) {
            // Extract the name of the lambda (the name of the directory)
            const name = path.basename(lambdaPath);
            let handler = 'handler';
            let moduleName = 'index';
            let configPath;

            // Check if there is a configuration file, which may contain customised
            // handler/module name
            const lambdaCustomCF = path.join(lambdaPath, 'cf.json');
            if (fsx.fileExists(lambdaCustomCF)) {
                configPath = lambdaCustomCF;

                const config = fsx.readJSONFileSync(lambdaCustomCF);
                const moduleHandler = _.get(config, 'Properties.Handler', `${moduleName}.${handler}`);

                moduleName = moduleHandler.split('.', 1)[0];
                handler = moduleHandler.split('.', 2)[1];
            }

            return {
                name: name,
                config: configPath,
                module: moduleName,
                handler: handler,
                path: path.resolve(lambdaPath, `${moduleName}.js`)
            };
        });

        resolve(lambdas);
    });
}