'use strict';
/* eslint max-len: ["off"] */

const assert = require('assert');
const PluginError = require('plugin-error');
const Vinyl = require('vinyl');
const sourceMaps = require('gulp-sourcemaps');
const postcss = require('../');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const path = require('path');
const from = require('from2-array');
const syntax = require('postcss-syntax');

it('should pass file when it isNull()', (cb) => {
	const stream = postcss([ doubler ]);
	const emptyFile = new Vinyl();

	stream.once('data', (data) => {
		assert.equal(data, emptyFile);
		cb();
	});

	stream.write(emptyFile);

	stream.end();
});

it('should transform css with multiple processors', (cb) => {
	const stream = postcss(
		[ asyncDoubler, objectDoubler() ]
	);

	stream.on('data', (file) => {
		const result = file.contents.toString('utf8');
		const target = 'a { color: black; color: black; color: black; color: black }';
		assert.equal(result, target);
		cb();
	});

	stream.write(new Vinyl({
		contents: Buffer.from('a { color: black }'),
	}));

	stream.end();
});

it('should correctly wrap postcss errors', (cb) => {
	const stream = postcss([ doubler ]);

	stream.on('error', (err) => {
		assert.ok(err instanceof PluginError);
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

	stream.write(new Vinyl({
		contents: Buffer.from('a {'),
		path: path.resolve('testpath'),
	}));

	stream.end();
});

it('should transform css on stream files', (cb) => {
	const stream = postcss([ doubler ]);

	stream.on('data', (file) => {
		assert.equal(file.postcss.content, '.from {}');
		cb();
	});

	const streamFile = new Vinyl({
		contents: from([Buffer.from('.from {}')]),
		path: path.resolve('testpath'),
	});

	stream.write(streamFile);

	stream.end();
});

it('should generate source maps', (cb) => {
	const init = sourceMaps.init();
	const write = sourceMaps.write();
	const css = postcss(
		[ doubler, asyncDoubler ]
	);

	init
		.pipe(css)
		.pipe(write);

	write.on('data', (file) => {
		assert.equal(file.sourceMap.mappings, 'AAAA,IAAI,aAAY,CAAZ,aAAY,CAAZ,aAAY,CAAZ,YAAY,EAAE');
		assert(/sourceMappingURL=data:application\/json;(?:charset=\w+;)?base64/.test(file.contents.toString()));
		cb();
	});

	init.write(new Vinyl({
		base: __dirname,
		path: path.join(__dirname, 'fixture.css'),
		contents: Buffer.from('a { color: black }'),
	}));

	init.end();
});

it('should correctly generate relative source map', (cb) => {
	const init = sourceMaps.init();
	const css = postcss(
		[ doubler, doubler ]
	);

	init.pipe(css);

	css.on('data', (file) => {
		assert.equal(file.sourceMap.file, 'fixture.css');
		assert.deepEqual(file.sourceMap.sources, ['fixture.css']);
		cb();
	});

	init.write(new Vinyl({
		base: path.join(__dirname, 'src'),
		path: path.join(__dirname, 'src/fixture.css'),
		contents: Buffer.from('a { color: black }'),
	}));

	init.end();
});

describe('PostCSS Syntax Infer', () => {
	it('should parse less file with out syntax config', (cb) => {
		const stream = postcss([doubler]);
		const less = [
			'@base: #f938ab;',
			'.box {',
			'  color: saturate(@base, 5%);',
			'}',
		];

		stream.on('error', cb);
		stream.on('data', (file) => {
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

		stream.write(new Vinyl({
			base: path.join(__dirname, 'src'),
			path: path.join(__dirname, 'src/fixture.less'),
			contents: Buffer.from(less.join('\n')),
		}));

		stream.end();
	});

	it('should catch error from parser', (cb) => {
		const stream = postcss({
			syntax: {
				parse: () => {
					throw new Error('mock syntax error');
				},
			},
			plugins: [
				doubler,
			],
		});

		stream.on('error', (error) => {
			try {
				assert.equal(error.message, 'mock syntax error');
				assert.ifError(error.lineNumber);
				assert.ok(error.showStack);
				cb();
			} catch (ex) {
				cb(ex);
			}
		});

		stream.write(new Vinyl({
			base: path.join(__dirname, 'src'),
			path: path.join(__dirname, 'src/fixture.sass'),
			contents: Buffer.from('a {'),
		}));

		stream.end();
	});
});

describe('PostCSS Guidelines', () => {
	const sandbox = sinon.createSandbox();
	const CssSyntaxError = function (message, source) {
		this.name = 'CssSyntaxError';
		this.message = message;
		this.source = source;
		this.showSourceCode = function () {
			return this.source;
		};
		this.toString = function () {
			let code = this.showSourceCode();
			if (code) {
				code = '\n\n' + code + '\n';
			}
			return this.name + ': ' + this.message + code;
		};
	};
	const postcssStub = {
		use: function () {},
		process: function () {},
	};
	let postcssLoadConfigStub;
	const postcss = proxyquire('../', {
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

	beforeEach(() => {
		postcssLoadConfigStub = sandbox.stub();
		sandbox.stub(postcssStub, 'use');
		sandbox.stub(postcssStub, 'process');
	});

	afterEach(() => {
		sandbox.restore();
	});

	it('should set `from` and `to` processing options to `file.path`', (cb) => {
		const rename = require('gulp-rename')({
			extname: '.css',
		});
		const stream = postcss([ doubler ]);
		const mdPath = path.join(__dirname, '/src/fixture.md');
		const cssPath = path.join(__dirname, '/src/fixture.css');
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));

		rename.pipe(stream);

		stream.on('data', (file) => {
			const opts = postcssStub.process.getCall(0).args[1];
			try {
				assert.equal(opts.to, cssPath);
				assert.equal(opts.from, mdPath);
				cb();
			} catch (ex) {
				cb(ex);
			}
		});

		rename.write(new Vinyl({
			contents: Buffer.from('a {}'),
			path: mdPath,
		}));

		rename.end();
	});

	it('should allow override of `to` processing option', (cb) => {
		const stream = postcss({
			plugin: [ doubler ],
			to: 'overriden',
		});
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));

		stream.on('data', () => {
			assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden');
			cb();
		});

		stream.write(new Vinyl({
			contents: Buffer.from('a {}'),
		}));

		stream.end();
	});

	it('should take plugins and options from callback', (cb) => {
		const cssPath = path.join(__dirname, 'fixture.css');
		const file = new Vinyl({
			contents: Buffer.from('a {}'),
			path: cssPath,
		});
		const plugins = [ doubler ];
		const callback = sandbox.stub().returns({
			plugins: plugins,
			to: 'overriden',
		});
		const stream = postcss(callback);

		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));

		stream.on('data', () => {
			try {
				assert.deepEqual(callback.getCall(0).args[0], {
					cwd: process.cwd(),
					syntax: syntax,
					from: cssPath,
					file: file,
					map: false,
					to: 'overriden',
				});
				assert.deepEqual(postcssStub.use.getCall(0).args[0], plugins);
				assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden');
				cb();
			} catch (ex) {
				cb(ex);
			}
		});

		stream.on('error', cb);
		stream.end(file);
	});

	it('should take plugins and options from postcss-load-config', (cb) => {
		const cssPath = path.join(__dirname, 'fixture.css');
		const file = new Vinyl({
			contents: Buffer.from('a {}'),
			path: cssPath,
		});
		const stream = postcss();
		const plugins = [ doubler ];

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

		stream.on('data', () => {
			try {
				assert.deepEqual(postcssLoadConfigStub.getCall(0).args[0], {
					cwd: process.cwd(),
					syntax: syntax,
					from: cssPath,
					file: file,
					map: false,
					to: cssPath,
				});
				assert.equal(postcssStub.use.getCall(0).args[0], plugins);
				assert.equal(postcssStub.process.getCall(0).args[1].to, 'overriden');
				cb();
			} catch (ex) {
				cb(ex);
			}
		});

		stream.end(file);
	});

	it('should point the config location to file directory', (cb) => {
		const cssPath = path.join(__dirname, '/fixture.css');
		const stream = postcss();
		postcssLoadConfigStub.returns(Promise.resolve({ plugins: [] }));
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));
		stream.on('data', () => {
			assert.deepEqual(postcssLoadConfigStub.getCall(0).args[1], cssPath);
			cb();
		});
		stream.end(new Vinyl({
			contents: Buffer.from('a {}'),
			path: cssPath,
		}));
	});

	it('should set the config location from `file.path', (cb) => {
		const cssPath = path.join(__dirname, 'fixture.css');
		const stream = postcss();
		postcssLoadConfigStub.returns(Promise.resolve({ plugins: [] }));
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [];
			},
		}));
		stream.on('data', () => {
			assert.deepEqual(postcssLoadConfigStub.getCall(0).args[1], cssPath);
			cb();
		});
		stream.end(new Vinyl({
			contents: Buffer.from('a {}'),
			path: cssPath,
		}));
	});

	it('should not override `from` and `map` if using gulp-sourcemaps', (cb) => {
		const stream = postcss([ doubler ], { from: 'overriden', map: 'overriden' });
		const cssPath = path.join(__dirname, 'fixture.css');
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

		// sandbox.stub(gutil, 'log');

		stream.on('data', () => {
			try {
				assert.deepEqual(postcssStub.process.getCall(0).args[1].from, cssPath);
				assert.deepEqual(postcssStub.process.getCall(0).args[1].map, { annotation: false });
			} catch (ex) {
				cb(ex);
				return;
			}
			cb();
		});

		const file = new Vinyl({
			contents: Buffer.from('a {}'),
			path: cssPath,
		});
		file.sourceMap = {};
		stream.end(file);
	});

	it('should not output js stack trace for `CssSyntaxError`', (cb) => {
		const stream = postcss([ doubler ]);
		const cssSyntaxError = new CssSyntaxError('messageText', 'sourceCode');
		postcssStub.process.returns(Promise.reject(cssSyntaxError));

		stream.on('error', (error) => {
			assert.equal(error.showStack, false);
			assert.equal(error.message, 'messageText\n\nsourceCode\n');
			assert.equal(error.source, 'sourceCode');
			cb();
		});

		stream.write(new Vinyl({
			contents: Buffer.from('a {}'),
		}));

		stream.end();
	});

	it('should get `result.warnings()` content', (cb) => {
		const stream = postcss([ doubler ]);
		const cssPath = path.join(__dirname, 'src/fixture.css');
		function Warning (msg) {
			this.toString = function () {
				return msg;
			};
		}

		// sandbox.stub(gutil, 'log');
		postcssStub.process.returns(Promise.resolve({
			content: '',
			warnings: function () {
				return [new Warning('msg1'), new Warning('msg2')];
			},
		}));

		stream.on('data', (file) => {
			const warnings = file.postcss.warnings();
			assert.equal(warnings[0].toString(), 'msg1');
			assert.equal(warnings[1].toString(), 'msg2');
			cb();
		});

		stream.write(new Vinyl({
			contents: Buffer.from('a {}'),
			path: cssPath,
		}));

		stream.end();
	});
});

describe('<style> tag', () => {
	it('LESS in HTML', (cb) => {
		function createHtml (css) {
			return '<html><head><style type="text/less">' + css + '</style></head></html>';
		}

		const stream = postcss(
			[ asyncDoubler, objectDoubler() ]
		);

		stream.on('data', (file) => {
			const result = file.contents.toString('utf8');
			const target = createHtml('a { color: black; color: black; color: black; color: black }');
			assert.equal(result, target);
			cb();
		});

		stream.write(new Vinyl({
			contents: Buffer.from(createHtml('a { color: black }')),
			path: '/test/fixture_style_tag.html',
		}));

		stream.on('error', cb);
		stream.end();
	});

	it('HTML without <style> tag', (cb) => {
		const html = '<html><body></body></html>';

		const stream = postcss(
			[ asyncDoubler, objectDoubler() ]
		);

		stream.on('data', (file) => {
			const result = file.contents.toString('utf8');
			try {
				assert.equal(result, html);
				cb();
			} catch (error) {
				cb(error);
			}
		});

		stream.write(new Vinyl({
			contents: Buffer.from(html),
			path: '/test/fixture_without_style_tag.html',
		}));

		stream.on('error', cb);
		stream.end();
	});

	it('remove nodes from root', (cb) => {
		function createHtml (css) {
			return '<html><head><style>' + css + '</style></head></html>';
		}

		const stream = postcss([
			function (root) {
				root.nodes = [];
			},
		]);

		stream.on('data', (file) => {
			const result = file.contents.toString('utf8');
			const target = createHtml('');
			assert.equal(result, target);
			cb();
		});

		stream.write(new Vinyl({
			contents: Buffer.from(createHtml('a { color: black }')),
			path: '/test/fixture_remove_nodes.html',
		}));

		stream.on('error', cb);
		stream.end();
	});

	it('vue component', (cb) => {
		function createVue (css) {
			return '<style lang="less">' + css + '</style>';
		}

		const stream = postcss(
			[ asyncDoubler, objectDoubler() ]
		);

		stream.on('data', (file) => {
			const result = file.contents.toString('utf8');
			const target = createVue('a { color: black; color: black; color: black; color: black }');
			assert.equal(result, target);
			cb();
		});

		stream.write(new Vinyl({
			contents: Buffer.from(createVue('a { color: black }')),
			path: '/test/fixture.vue',
		}));

		stream.on('error', cb);
		stream.end();
	});
});

function doubler (css) {
	css.walkDecls((decl) => {
		decl.parent.prepend(decl.clone());
	});
}

function asyncDoubler (css) {
	return new Promise((resolve) => {
		setTimeout(() => {
			doubler(css);
			resolve();
		});
	});
}

function objectDoubler () {
	const processor = require('postcss')();
	processor.use(doubler);
	return processor;
}
