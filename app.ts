#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import * as request from "request";
import * as chalk from "chalk";
import * as figures from "figures";
import * as args from "args";
import * as commandExists from "command-exists";

// list of supported package manager tools
// the first one found will be default
const tools = {
  npm: { command: "npm install --save-dev" },
  yarn: { command: "yarn add -D" },
} as Record<string, { command: string } | undefined>;

// look for the first available tool
let defaultTool;
for (const tool of Object.keys(tools)) {
  if (commandExists.sync(tool)) {
    defaultTool = tool;
    break;
  }
}
if (defaultTool === undefined) {
  console.error("Couldn't find a supported package manager tool.");
}

// support for overriding default
args.option("tool", "Which package manager tool to use", defaultTool);
const opts = args.parse(process.argv, {
  name: "ts-typie",
  mri: undefined,
  mainColor: "yellow",
  subColor: "dim",
});
const tool = tools[opts.tool];

// check if package.json exists

const cwd = process.cwd();
const packagePath = path.join(cwd, "package.json");

if (!fs.existsSync(packagePath)) {
  console.error("No package.json file found!");
  process.exit();
}

// Package.json exists

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
let dependencies: string[] = [];

if (pkg.dependencies) {
  dependencies.push(...Object.keys(pkg.dependencies));
}
if (pkg.devDependencies) {
  dependencies.push(...Object.keys(pkg.devDependencies));
}

// Filter out already installed types

let alreadyInstalledTypes = dependencies.filter((d) => /^@types\//.test(d));
dependencies = dependencies.filter((d) => !/^@types\//.test(d));

processAllDependencies(dependencies);

async function processAllDependencies(dependencies: string[]) {
  const missingPackages: string[] = [];
  for (let dependency of dependencies) {
    const packageToInstall = await processDependency(dependency);
    if (packageToInstall) {
      missingPackages.push(packageToInstall);
    }
  }

  if (missingPackages.length > 0) {
    await installPackages(missingPackages);
  }
}

async function installPackages(packages: string[]) {
  const packageString = packages.join(" ");
  const command = `${tool.command} ${packageString}`;

  console.log(
    chalk.green(
      figures.play,
      `Installing types for ${packages.length} packages: ${packageString}`
    )
  );

  await new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (err) {
        console.error(stderr);
        reject(err);
      } else {
        console.log(stdout);
        resolve(stdout);
      }
    });
  });
}

async function processDependency(dependency: string): Promise<string | null> {
  const dependencyString = chalk.bold(dependency);

  // Check if types are already installed

  if (alreadyInstalledTypes.includes("@types/" + dependency)) {
    console.log(
      chalk.yellow(
        figures.play,
        `Types for ${dependencyString} already installed. Skipping...`
      )
    );
    return null;
  }

  // Check for included types
  let pkgPath = path.join(cwd, "node_modules", dependency, "package.json");

  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.types || pkg.typings) {
      console.log(
        chalk.yellow(
          figures.warning,
          `Module ${dependencyString} includes own types. Skipping...`
        )
      );
      return null;
    }
  }

  // Check if types are available

  return await new Promise((resolve) =>
    ((dependency) => {
      const packageName = `@types/${dependency}`;
      request("https://registry.npmjs.org/" + packageName, (err, res, body) => {
        if (res.statusCode == 200) {
          resolve(packageName);
        } else {
          console.log(
            chalk.red(
              figures.cross,
              `No types found for ${dependencyString} in registry. Skipping...`
            )
          );
          resolve(null);
        }
      });
    })(dependency)
  );
}
