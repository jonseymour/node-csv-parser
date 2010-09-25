
// Module CSV - Copyright David Worms <open@adaltas.com> (MIT Licensed)

var EventEmitter = require('events').EventEmitter,
	fs = require('fs');

// Utils function
var merge = function(obj1,obj2){
	var r = obj1||{};
	for(var key in obj2){
		r[key] = obj2[key];
	}
	return r;
}

module.exports = function(){
	var state = {
		count: 0,
		field: '',
		line: [],
		lastC: '',
		quoted: false,
		commented: false,
		buffer: null,
		bufferPosition: 0
	}
	
	// Defined Class
	
	var CSV = function(){
		// Set options
		this.readOptions = {
			flags: 'r',
			encoding: 'utf8',
			bufferSize: 8 * 1024 * 1024,
			delimiter: ',',
			quote: '"',
			escape: '"'
		};
		this.writeOptions = {
			bufferSize: null,
			lineBreaks: null
		};
	}
	CSV.prototype.__proto__ = EventEmitter.prototype;
	
	// Reading API
	
	CSV.prototype.from = function(data,options){
		var self = this;
		process.nextTick(function(){
			parse(data);
			finish();
		});
		return this;
	}
	CSV.prototype.fromStream = function(readStream, options){
		if(!readStream instanceof EventEmitter) throw new Error('Invalid stream');
		if(options){
			merge(this.readOptions,options);
		}
		var self = this;
		readStream.on('data', function(data) { parse(data) });
		readStream.on('error', function(error) { self.emit('error', error) });
		readStream.on('end', function() {
			finish();
		});
		this.readStream = readStream;
		return this;
	}
	CSV.prototype.fromPath = function(path, options){
		merge(this.readOptions, options);
		var stream = fs.createReadStream(path, this.readOptions);
		stream.setEncoding(this.readOptions.encoding);
		return this.fromStream(stream, null);
	}
	
	// Writting API
	
	CSV.prototype.toStream = function(writeStream, options){
		if(!writeStream instanceof EventEmitter) throw new Error('Invalid stream');
		var self = this;
		merge(this.writeOptions,options);
		switch(this.writeOptions.lineBreaks){
			case 'auto':
				this.writeOptions.lineBreaks = null;
				break;
			case 'unix':
				this.writeOptions.lineBreaks = "\n";
				break;
			case 'mac':
				this.writeOptions.lineBreaks = "\r";
				break;
			case 'windows':
				this.writeOptions.lineBreaks = "\r\n";
				break;
			case 'unicode':
				this.writeOptions.lineBreaks = "\u2028";
				break;
		}
		writeStream.on('close', function(){
			self.emit('end',state.count);
		})
		this.writeStream = writeStream;
		state.buffer = new Buffer(this.writeOptions.bufferSize||this.readOptions.bufferSize);
		state.bufferPosition = 0;
		return this;
	}
	CSV.prototype.toPath = function(path, options){
		merge(options, {
			flags: 'w',
			encoding: 'utf8'
		});
		var stream = fs.createWriteStream(path, options);
		return this.toStream(stream, options);
	}
	
	// Transform API
	
	CSV.prototype.transform = function(callback){
		this.transformer = callback;
		return this;
	}
	
	var csv = new CSV();

	function parse(chars){
		chars = ''+chars;
		for (var i = 0, l = chars.length; i < l; i++) {
			var c = chars.charAt(i);
			switch (c) {
				case csv.readOptions.escape:
				case csv.readOptions.quote:
					if( state.commented ) break;
					var isEscape = false;
					if (c === csv.readOptions.escape) {
						var nextChar = chars.charAt(i + 1);
						if (nextChar === csv.readOptions.escape || nextChar === csv.readOptions.quote) {
							i++;
							isEscape = true;
							c = chars.charAt(i);
							state.field += c;
						}
					}
					if (!isEscape && (c === csv.readOptions.quote)) {
						if (state.field && !state.quoted) {
							// Treat quote as a regular character
							state.field += c;
							break;
						}
						if (state.quoted) {
							// Make sure a closing quote is followed by a delimiter
							var nextChar = chars.charAt(i + 1);
							if (nextChar && nextChar != '\r' && nextChar != '\n' && nextChar !== csv.readOptions.delimiter) {
								throw new Error('Invalid closing quote; found "' + nextChar + '" instead of delimiter "' + csv.readOptions.delimiter + '"');
							}
							state.quoted = false;
						} else if (state.field === '') {
							state.quoted = true;
						}
					}
					break;
				case csv.readOptions.delimiter:
					if( state.commented ) break;
					if( state.quoted ) {
						state.field += c;
					}else{
						state.line.push(state.field);
						state.field = '';
					}
					break;
				case '\n':
					if( !csv.readOptions.quoted && state.lastC === '\r' ){
						break;
					}
				case '\r':
					if( csv.writeOptions.lineBreaks === null ){
						csv.writeOptions.lineBreaks = c + ( c === '\r' && chars.charAt(i+1) === '\n' ? '\n' : '' );
					}
					state.line.push(state.field);
					state.field = '';
					flush();
					break;
				default:
					if (state.commented) break;
					state.field += c;
			}
			state.lastC = c;
		}
	}

	function flush(){
		var line = csv.transformer?csv.transformer(state.line,state.count):state.line;
		if(line !== null){
			csv.emit('data',line,state.count);
		}
		state.count++;
		if(line !== null){
			if(typeof line === 'object'){
				if(line instanceof Array){
					var newLine = '';
					line.forEach(function(field,i){
						var containsdelimiter = field.indexOf(csv.writeOptions.delimiter||csv.readOptions.delimiter)>=0;
						var containsQuote = field.indexOf(csv.writeOptions.quote||csv.readOptions.quote)>=0;
						if(containsQuote){
							field = field.replace(csv.writeOptions.quote||csv.readOptions.quote,(csv.writeOptions.escape||csv.readOptions.escape)+(csv.writeOptions.quote||csv.readOptions.quote));
						}
						if(containsQuote||containsdelimiter){
							field = (csv.writeOptions.quote||csv.readOptions.quote)+field+(csv.writeOptions.quote||csv.readOptions.quote);
						}
						newLine += field;
						if(i!==line.length-1){
							newLine += (csv.writeOptions.delimiter||csv.readOptions.delimiter)
						}
					});
					line = newLine+csv.writeOptions.lineBreaks;
				}else{
					
				}
			}
			if(state.buffer){
				if(state.bufferPosition+Buffer.byteLength(line,'utf8')>csv.readOptions.bufferSize){
					csv.writeStream.write(state.buffer.slice(0, state.bufferPosition));
					state.buffer = new Buffer(csv.readOptions.bufferSize);
					state.bufferPosition = 0;
				}
				state.bufferPosition += state.buffer.write(line,state.bufferPosition,'utf8');
			}
		}
		state.line = [];
		state.lastC = '';
	}
	function finish(){
		if (state.quoted) {
			csv.emit('error', new Error('Quoted field not terminated'));
		} else {
			// dump open record
			if (state.field) {
				state.line.push(state.field);
				state.field = '';
			}
			if (state.line.length > 0) {
				flush();
			}
			if(csv.writeStream){
				csv.writeStream.write(state.buffer.slice(0, state.bufferPosition));
				csv.writeStream.end();
			}else{
				csv.emit('end',state.count);
			}
		}
	}
	return csv;
};