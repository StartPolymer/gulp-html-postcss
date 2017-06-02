'use strict';
/* eslint-env node, mocha */
/* eslint max-len: ["off"] */

var assert = require('assert');
var gutil = require('gulp-util');
var sourceMaps = require('gulp-sourcemaps');
var postcss = require('../');
var proxyquire = require('proxyquire');
var sinon = require('sinon');
var path = require('path');
var syntax = require('postcss-html');
const from = require('from2-array');

it('should pass file when it isNull()', function (cb) {
	var stream = postcss([ doubler ]);
	var emptyFile = new gutil.File();

	stream.once('data', function (data) {
		assert.equal(data, emptyFile);
		cb();
	});

	stream.write(emptyFile);

	stream.end();
});

it('should transform css with multiple processors', function (cb) {

	var stream = postcss(
    [ asyncDoubler, objectDoubler() ]
  );

	stream.on('data', function (file) {
		var result = file.contents.toString('utf8');
		var target = 'a { color: black; color: black; color: black; color: black }';
		assert.equal( result, target );
		cb();
	});

	stream.write(new gutil.File({
		contents: new Buffer('a { color: black }'),
	}));

	stream.end();

});


it('should correctly wrap postcss errors', function (cb) {

	var stream = postcss([ doubler ]);

	stream.on('error', function (err) {
		assert.ok(err instanceof gutil.PluginError);
		assert.equal(err.plugin, 'gulp-postcss');
		assert.equal(err.column, 1);
		assert.equal(err.lineNumber, 1);
		assert.equal(err.name, 'CssSyntaxError');
		assert.equal(err.reason, 'Unclosed block');
		assert.equal(err.showStack, false);
		assert.equal(err.source, 'a {');
		assert.equal(err.fileName, path.resolve('testpath'));
		cb();
	});

	stream.write(new gutil.File({
		contents: new Buffer('a {'),
		path: path.resolve('testpath'),
	}));

	stream.end();

});

it('should transform css on stream files', function (cb) {

	var stream = postcss([ doubler ]);

	stream.on('data', function (file) {
		assert.equal(file.postcss.content, '.from {}');
		cb();
	});

	var streamFile = new gutil.File({
		contents: from([new Buffer('.from {}')]),
		path: path.resolve('testpath'),
	});

	stream.write(streamFile);

	stream.end();

});

it('should generate source maps', function (cb) {

	var init = sourceMaps.init();
	var write = sourceMaps.write();
	var css = postcss(
    [ doubler, asyncDoubler ]
  );

	init
    .pipe(css)
    .pipe(write);

	write.on('data', function (file) {
		assert.equal(file.sourceMap.mappings, 'AAAA,IAAI,aAAY,CAAZ,aAAY,CAAZ,aAAY,CAAZ,YAAY,EAAE');
		assert(/sourceMappingURL=data:application\/json;(?:charset=\w+;)?base64/.test(file.contents.toString()));
		cb();
	});

	init.write(new gutil.File({
		base: __dirname,
		path: __dirname + '/fixture.css',
		contents: new Buffer('a { color: black }'),
	}));

	init.end();

});


it('should correctly generate relative source map', function (cb) {

	var init = sourceMaps.init();
	var css = postcss(
    [ doubler, doubler ]
  );

	init.pipe(css);

	css.on('data', function (file) {
		assert.equal(file.sourceMap.file, 'fixture.css');
		assert.deepEqual(file.sourceMap.sources, ['fixture.css']);
		cb();
	});

	init.write(new gutil.File({
		base: __dirname + '/src',
		path: __dirname + '/src/fixture.css',
		contents: new Buffer('a { color: black }'),
	}));

	init.end();

});

describe('PostCSS Syntax Infer', function () {
	it('should parse less file with out syntax config', function (cb) {
		var stream = postcss([doubler]);
		var less = [
			'@base: #f938ab;',
			'.box {',
			'  color: saturate(@base, 5%);',
			'}',
		];

		stream.on('error', cb);
		stream.on('data', function(file) {
			assert.equal(file.contents.toString(), [
				less[0],
				less[0],
				less[1],
				less[2],
				less[2],
				less[3],
			].join('\n'));
			cb();
		});

		stream.write(new gutil.File({
			base: __dirname + '/src',
			path: __dirname + '/src/fixture.less',
			contents: new Buffer(less.join('\n')),
		}));

		stream.end();
	});

	it('should show error for `MODULE_NOT_FOUND`', function (cb) {
		var stream = postcss([doubler]);

		stream.on('error', function(error) {
			assert.equal(error.code, 'MODULE_NOT_FOUND');
			assert.equal(error.message, 'Cannot find module \'postcss-sass\'');
			cb();
		});

		stream.write(new gutil.File({
			base: __dirname + '/src',
			path: __dirname + '/src/fixture.sass',
			contents: new Buffer('a {'),
		}));

		stream.end();
	});
});

describe('PostCSS Guidelines', function () {

	var sandbox = sinon.sandbox.create();
	var CssSyntaxError = function (message, source) {
		this.name = 'CssSyntaxError';
		this.message = message;
		this.source = source;
		this.showSourceCode = function () {
			return this.source;
		};
		this.toString = function(){
			var code = this.showSourceCode();
			if ( code ) {
				code = '\n\n' + code + '\n';
			}
			return this.name + ': ' + this.message + code;
		};
	};
	var postcssStub = {
		use: function () {},
		process: function () {},
	};
	var postcssLoadConfigStub;
	var postcss = proxyquire('../', {
		'./process': proxyquire('../lib/process', {
			postcss: function (plugins) {
				postcssStub.use(plugins);
				return postcssStub;
			},
			'./loadConfig': proxyquire('../lib/loadConfig', {
				'postcss-load-config': function (ctx, configPath) {
					return postcssLoadConfigStub(ctx, configPath);
				},
			}),
			'./applySourceMap': proxyquire('../lib/applySourceMap', {
				'vinyl-sourcemaps-apply': function () {
					return {};
				},
			}),
		}),
	});

	beforeEach(function () {
		postcssLoadConfigStub = sandbox.stub();
		sandbox.stub(postcssStub, 'use');
		sandbox.stub(postcssStub, 'process');
	});

	afterEach(function () {
		sandbox.restore();
	});

	it('should set `from` and `to` processing options to `file.path`', function (cb) {

		var rename = require('gulp-rename')({
			extname: '.css',
		});
		var stream = postcss([ doubler ]);
		var mdPath = path.join(__dirname, '/src/fixture.md');
		var cssPath = path.join(__dirname, '/src/fixture.css');
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));

		rename.pipe(stream);

		stream.on('data', function () {
			assert.equal(postcssStub.process.getCall(0).args[1].to, cssPath);
			assert.equal(postcssStub.process.getCall(0).args[1].from, mdPath);
			cb();
		});

		rename.write(new gutil.File({
			contents: new Buffer('a {}'),
			path: mdPath,
		}));

		rename.end();

	});

	it('should allow override of `to` processing option', function (cb) {

		var stream = postcss({
			plugin: [ doubler ],
			to: 'overriden',
		});
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));

		stream.on('data', function () {
			assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden');
			cb();
		});

		stream.write(new gutil.File({
			contents: new Buffer('a {}'),
		}));

		stream.end();

	});

	it('should take plugins and options from callback', function (cb) {

		var cssPath = path.join(__dirname, 'fixture.css');
		var file = new gutil.File({
			contents: new Buffer('a {}'),
			path: cssPath,
		});
		var plugins = [ doubler ];
		var callback = sandbox.stub().returns({
			plugins: plugins,
			to: 'overriden',
		});
		var stream = postcss(callback);

		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));

		stream.on('data', function () {
			assert.deepEqual(callback.getCall(0).args[0], {
				cwd: process.cwd(),
				from: cssPath,
				file: file,
				map: false,
				syntax: syntax,
				to: 'overriden',
			});
			assert.deepEqual(postcssStub.use.getCall(0).args[0], plugins);
			assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden');
			cb();
		});

		stream.end(file);

	});

	it('should take plugins and options from postcss-load-config', function (cb) {

		var cssPath = path.join(__dirname, 'fixture.css');
		var file = new gutil.File({
			contents: new Buffer('a {}'),
			path: cssPath,
		});
		var stream = postcss();
		var plugins = [ doubler ];

		postcssLoadConfigStub.returns(Promise.resolve({
			plugins: plugins,
			options: { to: 'overriden' },
		}));

		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));

		stream.on('data', function () {
			assert.deepEqual(postcssLoadConfigStub.getCall(0).args[0], {
				cwd: process.cwd(),
				from: cssPath,
				file: file,
				map: false,
				syntax: syntax,
				to: cssPath,
			});
			assert.equal(postcssStub.use.getCall(0).args[0], plugins);
			assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden');
			cb();
		});

		stream.end(file);

	});

	it('should point the config location to file directory', function (cb) {
		var cssPath = path.join(__dirname, '/fixture.css');
		var stream = postcss();
		postcssLoadConfigStub.returns(Promise.resolve({ plugins: [] }));
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));
		stream.on('data', function () {
			assert.deepEqual(postcssLoadConfigStub.getCall(0).args[1], cssPath);
			cb();
		});
		stream.end(new gutil.File({
			contents: new Buffer('a {}'),
			path: cssPath,
		}));
	});

	it('should set the config location from `file.path', function (cb) {
		var cssPath = path.join(__dirname, 'fixture.css');
		var stream = postcss();
		postcssLoadConfigStub.returns(Promise.resolve({ plugins: [] }));
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));
		stream.on('data', function () {
			assert.deepEqual(postcssLoadConfigStub.getCall(0).args[1], cssPath);
			cb();
		});
		stream.end(new gutil.File({
			contents: new Buffer('a {}'),
			path: cssPath,
		}));
	});

	it('should not override `from` and `map` if using gulp-sourcemaps', function (cb) {
		var stream = postcss([ doubler ], { from: 'overriden', map: 'overriden' });
		var cssPath = __dirname + '/fixture.css';
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
			map: {
				toJSON: function () {
					return {
						sources: [],
						file: '',
					};
				},
			},
		}));

		sandbox.stub(gutil, 'log');

		stream.on('data', function () {
			assert.deepEqual(postcssStub.process.getCall(0).args[1].from, cssPath);
			assert.deepEqual(postcssStub.process.getCall(0).args[1].map, { annotation: false });
			cb();
		});

		var file = new gutil.File({
			contents: new Buffer('a {}'),
			path: cssPath,
		});
		file.sourceMap = {};
		stream.end(file);
	});

	it('should not output js stack trace for `CssSyntaxError`', function (cb) {

		var stream = postcss([ doubler ]);
		var cssSyntaxError = new CssSyntaxError('messageText', 'sourceCode');
		postcssStub.process.returns(Promise.reject(cssSyntaxError));

		stream.on('error', function (error) {
			assert.equal(error.showStack, false);
			assert.equal(error.message, 'messageText\n\nsourceCode\n');
			assert.equal(error.source, 'sourceCode');
			cb();
		});

		stream.write(new gutil.File({
			contents: new Buffer('a {}'),
		}));

		stream.end();

	});


	it('should get `result.warnings()` content', function (cb) {

		var stream = postcss([ doubler ]);
		var cssPath = __dirname + '/src/fixture.css';
		function Warning (msg) {
			this.toString = function () {
				return msg;
			};
		}

		sandbox.stub(gutil, 'log');
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [new Warning('msg1'), new Warning('msg2')];
			},
		}));

		stream.on('data', function (file) {
			var warnings = file.postcss.warnings();
			assert.equal(warnings[0].toString(), 'msg1');
			assert.equal(warnings[1].toString(), 'msg2');
			cb();
		});

		stream.write(new gutil.File({
			contents: new Buffer('a {}'),
			path: cssPath,
		}));

		stream.end();

	});

});

describe('<style> tag', function () {

	it('less in html', function (cb) {
		function createHtml(css){
			return '<html><head><style type="text/less">' + css + '</style></head></html>';
		}

		var stream = postcss(
      [ asyncDoubler, objectDoubler() ]
    );

		stream.on('data', function (file) {
			var result = file.contents.toString('utf8');
			var target = createHtml('a { color: black; color: black; color: black; color: black }');
			assert.equal( result, target );
			cb();
		});

		stream.write(new gutil.File({
			contents: new Buffer(createHtml('a { color: black }')),
		}));

		stream.end();
	});

	it('vue component', function (cb) {
		function createVue(css) {
			return '<style lang="less">' + css + '</style>';

		}

		var stream = postcss(
      [ asyncDoubler, objectDoubler() ]
    );

		stream.on('data', function (file) {
			var result = file.contents.toString('utf8');
			var target = createVue('a { color: black; color: black; color: black; color: black }');
			assert.equal( result, target );
			cb();
		});

		stream.write(new gutil.File({
			contents: new Buffer(createVue('a { color: black }')),
		}));

		stream.end();
	});

});

function doubler (css) {
	css.walkDecls(function (decl) {
		decl.parent.prepend(decl.clone());
	});
}

function asyncDoubler (css) {
	return new Promise(function (resolve) {
		setTimeout(function () {
			doubler(css);
			resolve();
		});
	});
}

function objectDoubler () {
	var processor = require('postcss')();
	processor.use(doubler);
	return processor;
}