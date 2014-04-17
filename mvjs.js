var fs = require('fs');
var Module = require('module');
var path = require('path');
var uglifyjs = require('uglify-js');
var walk = require('walk');

function SourceCode(fileName) {
  this._fileName = fileName;
  this.text = fs.readFileSync(this._fileName, 'utf-8');
  this._currentPositionDelta = 0;
  this.modified = false;
  this._crlf = /\r\n/.test(this.text);
  if (this._crlf) {
    this.text = this.text.replace(/\r\n/g, '\n');
  }
}

SourceCode.prototype = {

  updateNodeValue: function(node, newValue) {
    var startPos = node.start.pos + this._currentPositionDelta;
    var endPos = node.end.endpos + this._currentPositionDelta;
    this.text = this.text.substr(0, startPos + 1) + newValue + this.text.substr(endPos - 1);
    this._currentPositionDelta += (newValue.length - node.value.length);
    this.modified = true;
  },

  write: function(fileName) {
    fileName = fileName || this._fileName;
    fs.writeFileSync(fileName, (this._crlf ? this.text.replace(/\n/g, '\r\n') : this.text));
  }

};

function isRelativeRequire(requirePath) {
  return /^[\.\/]/.test(requirePath);
}

function findRelativeRequireArgs(text, fileName) {
  var relativeRequireArgs = [];
  var ast;
  text = text.replace(/\r\n/g, '\n');
  try {
    ast = uglifyjs.parse(text);
  } catch (err) {
    return [];
  }
  ast.walk(new uglifyjs.TreeWalker(function(node) {
    if (node instanceof uglifyjs.AST_Call && node.expression.name === 'require') {
      var arg = node.args[0];
      if (arg instanceof uglifyjs.AST_String) {
        if (isRelativeRequire(arg.value)) {
          relativeRequireArgs.push(arg);
        }
      } else {
        var startPos = arg.start.pos;
        var endPos = arg.end.endpos;
        console.warn('Warning: cannot update non-constant require: ' +
                     text.substring(startPos, endPos) +
                     ' (' + path.relative(process.cwd(), fileName) + ':' + arg.start.line + ')');
      }
    }
  }));
  return relativeRequireArgs;
}

// all paths must be absolute
function updateRequires(fileToUpdate, fromPath, toPath, filterFn) {
  var code = new SourceCode(fileToUpdate);
  var dirname = path.dirname(fileToUpdate);

  findRelativeRequireArgs(code.text, fileToUpdate).forEach(function(arg) {
    try {
      var fullRequirePath = Module._resolveFilename(arg.value, {
        filename: fileToUpdate,
        id: fileToUpdate,
        paths: Module._nodeModulePaths(dirname)
      });
    } catch (err) {
      // Ignore it
    }
    if (fullRequirePath === fromPath) {
      var newValue = path.relative(dirname, toPath);
      if (!isRelativeRequire(newValue)) {
        newValue = './' + newValue;
      }
      if (!path.extname(arg.value)) {
        newValue = path.basename(newValue, path.extname(newValue));
      }
      code.updateNodeValue(arg, newValue);
    }
  });
  if (code.modified) {
    if (typeof filterFn === 'function') {
      code.text = filterFn(fileToUpdate, code.text) || code.text;
    }
    code.write();
    return true;
  } else {
    return false;
  }
}

function moveRequires(fileToUpdate, newFileLocation) {
  var code = new SourceCode(fileToUpdate);
  var dirname = path.dirname(fileToUpdate);
  var newDirname = path.dirname(newFileLocation);

  findRelativeRequireArgs(code.text, fileToUpdate).forEach(function(arg) {
    var newValue = path.relative(newDirname, path.resolve(dirname, arg.value));
    if (!isRelativeRequire(newValue)) {
      newValue = './' + newValue;
    }
    code.updateNodeValue(arg, newValue);
  });

  if (code.modified) {
    code.write();
    return true;
  } else {
    return false;
  }
}

function updateAllFiles(options, cb) {
  var fsWalker = walk.walk(options.rootDir);
  var filesModified = [];

  fsWalker.on('file', function (root, fileStats, next) {
    var fileName = path.join(root, fileStats.name);
    if (!/\/node_modules\//.test(fileName) && /\.js$/i.test(fileName) &&
        fileName !== options.fromPath && fileName !== options.toPath) {
      var modified = updateRequires(fileName, options.fromPath, options.toPath, options.filter);
      if (modified) {
        filesModified.push(path.relative(options.rootDir, fileName));
      }
    }
    next();
  });

  if (cb) {
    fsWalker.on('error', cb);
    fsWalker.on('end', function() {
      cb(null, filesModified);
    });
  }
}

/*
  Arguments:

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
function mvjs(options, cb) {
  options.rootDir = options.rootDir || process.cwd();
  updateAllFiles(options, function(err, filesModified) {
    moveRequires(options.fromPath, options.toPath);
    fs.renameSync(options.fromPath, options.toPath);
    cb && cb(err, filesModified);
  });
}

module.exports = mvjs;
