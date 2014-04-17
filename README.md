# mvjs

Move a JavaScript file and update all affected requires (in the file and references *to* the file) automatically.

## Installation:

    npm install -g mvjs

## Command Line Usage:

    cd path/to/my/project
    mvjs myfile.js newlocation.js

## Module Usage:

```javascript
var mvjs = require('mvjs');
/*
  options: object with the following keys:
    fromPath: (required) source path of the .js file to move, absolute or relative to rootDir
    toPath:   (required) destination path of the moved .js file, absolute or relative to rootDir
    rootDir:  (optional) project root directory that gets recursively scanned for references to the file to move
              default: process.cwd()
    filter:   (optional) function to call with the path and modified contents of every file that references the moved .js
              file via require(), so you can do regex substitution or the like. if the function returns a value,
              that value will overwrite the file.
              e.g.:
                function(modifiedFile, fileContents) { return fileContents.replace(/someVar/g, 'anotherVar'); }
  cb: (optional) function to call when move is complete, called with an error, if any, as the first parameter
    and an array of modified filenames as the second
    e.g.:
      function(err, filesModified) { ... }
*/
mvjs({
  fromPath: 'myfile.js',
  toPath:   'newlocation.js',
  rootDir:  'path/to/my/project',
  filter: function(modifiedFile, fileContents) {
    return fileContents.replace(/someVar/g, 'anotherVar');
  }
}, function(err, filesModified) {
  if (!err) {
    console.log('Requires updated in files: ' + filesModified.join(','));
  }
});
```

## License

    MIT. See included LICENSE file.
