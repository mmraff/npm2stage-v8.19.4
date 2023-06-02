# @offliner/npm2stage-v8.19.4
CLI to manage [**npm-two-stage**](https://github.com/mmraff/npm-two-stage/tree/npm8.19.4 "Learn why you might want this!") installation for npm 8.19.4

## Installation
```
$ npm install -g @offliner/npm2stage-v8.19.4
```

## Usage
The installed npm that is to be the target of this tool's commands must be of the targeted version. If it doesn't match, the tool will tell you so, and it will not operate on it.

In these examples, the OS is Windows, the tool is used in a git bash console, and the target location is the typical global installation location. However, the tool (and [**npm-two-stage**](https://github.com/mmraff/npm-two-stage/tree/npm8.19.4 "Learn why you might want this!")) are platform-agnostic, and the target npm installation can be any accessible location, including on a removeable drive.
```
$ npm2stage status

    Checking npm version at given path...
    Target npm home is C:\Program Files\nodejs\node_modules\npm
    No backups present.
    No standard files missing.
    No new files present.
    npm-two-stage is not installed at this location.

```
At this point, it's appropriate to run `npm2stage install`.
```
$ npm2stage install

   Checking npm version at given path...
   Target npm home is C:\Program Files\nodejs\node_modules\npm
   Backing up files to be replaced:
     # (original files listed here)
   Copying into target directory:
     # (replacements and new files/dirs listed here)

   Installation of npm-two-stage was successful.

```
At this point, `npm download` and `npm install --offline` are ready to be used.

# 

```
$ npm2stage status

   Checking npm version at given path...
   Target npm home is C:\Program Files\nodejs\node_modules\npm
   All backups present.
   No standard files missing.
   All expected new files present.
   npm-two-stage is fully installed at this location.

```
At this point, you may run `npm2stage uninstall` (if you must).
```
$ npm2stage uninstall

   Checking npm version at given path...
   Target npm home is C:\Program Files\nodejs\node_modules\npm
   Removing items added by npm-two-stage install:
     # (replacements and new files/dirs listed here)
   Restoring backed-up original files...
     # (original files listed here)
    
   Removal of npm-two-stage was successful.

```

#

For the `install` and `uninstall` commands, there are the abbreviations that the power user of npm will be familiar with: `i` and `un`. Also for these two commands, there is the `--silent` option to mute output unless there is an error.

For help:
```
$ npm2stage help
```
...or specifically for a command:
```
$ npm2stage install -h
```
