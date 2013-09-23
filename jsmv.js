#!/usr/bin/env node

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

  writeIfModified: function(fileName) {
    fileName = fileName || this._fileName;
    if (this.modified) {
      fs.writeFileSync(fileName, (this._crlf ? this.text.replace(/\n/g, '\r\n') : this.text));
    }
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
function updateRequires(fileToUpdate, fromPath, toPath) {
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

  code.writeIfModified();
  return code.modified;
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

  code.writeIfModified();
  return code.modified;
}

function updateAllFiles(directory, fromPath, toPath, cb) {
  var fsWalker = walk.walk(directory);

  fsWalker.on('file', function (root, fileStats, next) {
    var fileName = path.join(root, fileStats.name);
    if (!/\/node_modules\//.test(fileName) && /\.js$/i.test(fileName) &&
        fileName !== fromPath && fileName !== toPath) {
      var changedText = updateRequires(fileName, fileToMove, newFileLocation);
      if (changedText) {
        console.log('Updated requires for file: ' + path.relative(process.cwd(), fileName));
      }
    }
    next();
  });

  cb && fsWalker.on('end', cb);
}

if (process.argv.length < 4) {
  console.log('Usage: ' + path.basename(process.argv[1]) + ' <file_to_move> <new_location>');
  process.exit(1);
}

var fileToMove = path.resolve(process.argv[2]);
var newFileLocation = path.resolve(process.argv[3]);
if (fs.existsSync(newFileLocation) && fs.statSync(newFileLocation).isDirectory()) {
  newFileLocation = path.join(newFileLocation, path.basename(fileToMove));
}

updateAllFiles(process.cwd(), fileToMove, newFileLocation, function() {
  moveRequires(fileToMove, newFileLocation);
  fs.renameSync(fileToMove, newFileLocation);
  console.log('Moved ' + path.relative(process.cwd(), fileToMove) +
              ' to ' + path.relative(process.cwd(), newFileLocation));
});

