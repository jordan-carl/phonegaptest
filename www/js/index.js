(function(){
"use strict";
var ON_DEVICE = document.URL.indexOf('http://') === -1;

function ViewModel() {
	var model = this;
	this.locations = ko.observableArray();
	this.filter = ko.observable('');
	this.authRequest = {
		login: ko.observable(),
		password: ko.observable(),
		status: ko.observable('ready'),
	};
	this.authToken = ko.observable();
	this.authStatus = ko.observable();
	this.selectionStack = [];
	this.currentLocation = ko.observable();
	this.currentPo = ko.observable();
	this.overallStatus = ko.computed(function() {
		var locs = this.locations();
		if (!locs || locs.length === 0)
			return '';
		for (var i = 0; i < locs.length; i++) {
			var loc = locs[i];
			if (loc.status() === 'checkedin')
				return 'checkedin';
		}
		return '';
	}, model);
	this.syncStatus = ko.observable('ok');
	this.webserviceRoot = (ON_DEVICE ? 'http://wfalk-desktop.divisions.asp:82' : '/test/webservice') + '/ServiceVerificationApp.svc';
	this.locationSorters = [
		{ id: 'cust', text: 'sort by customer', func: function(a,b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); }},
		{ id: 'dist', text: 'sort by distance', func: function(a,b) { return a.dist == b.dist ? 0 : (a.dist < b.dist ? -1 : 1); }},
	];
	this.currentSorter = ko.observable('dist');
	this.searchText = ko.observable('');
	this.uiphase = ko.computed(function() {
		if (model.currentPo())
			return 'po';
		if (model.currentLocation())
			return 'location';
		return 'locations';
	}, model);
	this.noteDraft = ko.observable('');
	this.editingNote = ko.observable(false);
	this.sendingNote = ko.observable(false);
	this.initializing = ko.observable(true);
	this.appwait = ko.computed(function() {
		return model.initializing() || model.authRequest.status() == 'requested';
	});
	this.rightNow = function() { return (new Date().getTime() / 1000); }

	this.doSync = function() {
		if (model.authToken() && model.authToken.expires < model.rightNow())
			model.authToken(false);
		if (!model.authToken())
			return;
		model.poManager.sendSyncRequest();
	};
	
	this.logout = function() {
		model.authToken(false);
		var db = model.db();
		db.transaction(
			function(tx) {
				tx.executeSql('DELETE FROM TOKEN', [],
					function(tx, results) {
					},
					function(err) {
						console.log("db store auth data failed: " + err);
					}
				);
			},
			function(err) {
				console.log("db store auth data failed: " + JSON.stringify(err));
			},
			function() {
			}
		);
	};
	
	this.post = function(options) {
		var event = "POST[" + options.path + "]"; 
		console.log(event);
		try {
			var $req = $.ajax({
				type: 'POST',
				url: model.webserviceRoot + ((!model.authToken() || options.noToken) ? '' : '/' + model.authToken().token) + options.path,
				contentType: 'application/json; charset=UTF-8',
				dataType: 'json',
				data: JSON.stringify(options.payload),
				success: function(a,b) { console.log(event + " success"); options.success(a,b); },
				error: function(a,b) { console.log(event + " error " + b); options.error(a,b); },
				timeout: options.timeout || 8000,
			});
		}
		catch (e) {
			console.log(event + " exception " + e);
			options.error(null, null, e);
		}
		
	};

	this.postSync = function(hashes, onsuccess, onfail) {
		model.syncStatus('waiting');
		model.post({
			path: '/purchaseorders/sync',
			payload: { hashes: hashes },
			success: function(response) {
				model.syncStatus('ok');
				model.receiveSync(response);
				if (onsuccess)
					onsuccess(response);
			},
			error: function(jqXHR, textStatus) {
				model.syncStatus('error');
			},
		});
	};

	this.postNote = function(po, note, onsuccess, onfail) {
		model.post({
			path: '/purchaseorders/' + po.id + '/notes',
			payload: { note: note },
			success: onsuccess,
			error: onfail,
		});
	};

	this.postCheckin = function(po, onsuccess, onfail) {
		var pos = model.lastPosition();
		model.post({
			path: '/purchaseorders/' + po.id + '/status',
			payload: { newStatus: 'checkedin', latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy },
			success: function(syncData) {
				model.receiveSync(syncData);
				onsuccess(syncData);
			},
			error: onfail,
		});
	};

	this.postStatus = function(po, status, onsuccess, onfail) {
		var pos = model.lastPosition();
		model.post({
			path: '/purchaseorders/' + po.id + '/status',
			payload: { newStatus: status, latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy },
			success: function(syncData) {
				model.receiveSync(syncData);
				onsuccess(syncData);
			},
			error: onfail,
		});
	};

	this.postLogin = function(auth, data, onsuccess, onfail) {
		var login = auth.login();
		var password = auth.password();
		auth.status('requested');
		model.post({
			noToken: true,
			path: '/auth/' + login,
			payload: {password: password, data: data},
			success: function(response) {
				auth.status('ready');
				if (response.status == "Authorized") {
					var expiry = Math.round(parseFloat(response.expires)) + Math.round((new Date().getTime() / 1000));
					console.log("Received token: " + response.token + " expires in: " + response.expires + ": absolute: " + expiry);
					model.onAuthenticated(response.token, expiry);
					onsuccess(response.token, expiry);
				}
				else {
					if (response.status == "Authorization failed")
						onfail("Authorization failed, please try again");
					else
						onfail(response.status);
				}
			},
			error: function(jqXHR, textStatus, e) {
				auth.status('ready');
				if (textStatus == "error")
					onfail("There was an unexpected problem processing this login request.  Please try again");
				else if (textStatus == "timeout")
					onfail("Unable to reach the server, please check your signal and data connection and try again.");
				else if (textStatus)
					onfail("There was a problem processing this login request (" + textStatus + ").  Please try again.");
				else
					onfail("There was a problem processing this login request (" + e.message + "). Please try again.");
			},
		});
	};

	this.checkinCurrentPo = function(onsuccess, onfail) {
		model.postStatus(model.currentPo(), 'checkedin', onsuccess, onfail);
	};
	
	this.tryCheckinCurrentPo = function(event) {
		var slider = event.detail.control;
		slider.disableWith("Checking in...");
		var success = function() {
			slider.enable();
			slider.direction(-event.detail.direction);
		}
		var fail = function() {
			slider.disableWith("Checkin failed");
			model.prompt('There was a problem encountered while trying to checkin.  Please check your signal and data connection and try again', 'Notice', 'OK');
			slider.direction(event.detail.direction);
			slider.enable();
		}
		model.checkinCurrentPo(success, fail)
	}
	
	this.checkoutCurrentPo = function(status, onsuccess, onfail) {
		model.postStatus(model.currentPo(), status, onsuccess, onfail);
	};

	this.tryCheckoutCurrentPo = function(event) {
		var slider = event.detail.control;
		var statuses = ['closed', 'reqauth', 'reqfollowup'];
		var status = statuses[event.detail.option.index];
		slider.disableWith("Checking out...");
		var success = function(syncData) {
			slider.enable();
			if (model.currentPo().status == 'closed')
				$sliderdiv.hide();
			slider.direction(-event.detail.direction);
		}
		var fail = function(jqXHR, textStatus, e) {
			slider.disableWith("Checkout failed");
			model.prompt('There was a problem encountered while trying to checkout.  Please check your signal and data connection and try again', 'Notice', 'OK');
			slider.enable();
			slider.direction(event.detail.direction);
		}
		model.checkoutCurrentPo(status, success, fail);
	}
	
	this.onAuthenticated = function(token, expires) {
		model.authToken({token: token, expires: expires});
		model.doSync();
		var db = model.db();
		db.transaction(
			function(tx) {
				tx.executeSql('INSERT INTO TOKEN (token, expires) VALUES (?, ?)', [token, expires],
					function(tx, results) {
					},
					function(err) {
						console.log("db store auth data failed: " + err);
					}
				);
			},
			function(err) {
				console.log("db store auth data failed: " + JSON.stringify(err));
			},
			function() {
			}
		);
	};

	this.prompt = function(message, title, button, callback) {
		button = button || "OK";
		title = title || "In Position";
		if (ON_DEVICE)
			navigator.notification.alert(message, callback, title, button);
		else {
			// when not on an actual device, we need to simulate
			// phonegap's alert (which is non-blocking)
			var $div = $('<div class="alert"/>');
			var $title = $('<div class="title"/>');
			$title.text(title);
			var $text = $('<div class="text"/>');
			$text.text(message);
			var $button = $('<button/>');
			$button.text(button);
			$div.append($title).append($text).append($button);
			$(document.body).append($div);
			var y = -($div.height() / 2) + 'px';
			$div.css('margin-top', y);
			$button.on('click', function(e) {
				if (callback)
					callback();
				$div.fadeOut(function() {
					$div.remove();
				});
			});
			$div.fadeIn();
		}
	};
	
	this.loginClick = function() {
		var auth = model.authRequest;
		
		if (!auth.login()) {
			model.prompt("Please enter a login", "Login", "OK");
			return;
		}
		
		if (!auth.password()) {
			model.prompt("Please enter a password", "Login", "OK");
			return;
		}

		var success = function(token, expires) {
		};
		var fail = function(message) {
			model.prompt(message, 'Login');
		};
		// TODO: add relevant device data below to 'data' param
		model.postLogin(auth, "", success, fail);
	};
	
	this.doAppAuth = function(done) {
		var db = model.db();
		var expiry = model.rightNow() + 60;
		db.transaction(
			function(tx) {
				tx.executeSql('DELETE FROM TOKEN WHERE expires <= ?', [expiry]);
				tx.executeSql('SELECT token FROM TOKEN WHERE expires > ? ORDER BY expires DESC', [expiry],
					function(tx, results) {
						done();
						if (results.rows.length > 0) {
							var r = results.rows.item(0);
							model.authToken({token: r.token, expires: r.expires});
							var now = new Date().getTime();
							var recheck = (r.expires * 1000) - now;
							if (recheck <= 0)
								recheck = 1;
							setTimeout(function() {
								model.doAppAuth(function() {});
							}, recheck);
						}
						else {
							model.authToken(false);
						}
					},
					function(err) {
						done();
						console.log("db get auth data failed: " + err);
					}
				);
			},
			function(err) {
				done();
				console.log("db get auth data failed: " + JSON.stringify(err));
			},
			function() {
			}
		);
	};
	
	this.takePic = function() {
		navigator.camera.getPicture(function(filename) {
			var url = '/' + model.token + '/purchaseorders/' + model.currentPo().id + '/pic';
			var options = new FileUploadOptions();
			options.fileKey = "image";
			options.fileName = filename.substr(filename.lastIndexOf('/') + 1);
			options.mimeType = "image/jpeg";
			options.params = {};
			var deleteFile = function(filename) {
				window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, function(fs) {
					fs.root.remove(filename, function() { console.log("local pic deleted"); }, function(err) { console.log("local pic delete failed: " + err); });
				}, null);
			};
			var success = function(r) {
				console.log("Code = " + r.responseCode);
				console.log("Response = " + r.response);
				console.log("Sent = " + r.bytesSent);
				deleteFile(filename);
			};
			var fail = function(error) {
				model.prompt("Uploading the image has failed: Code = " + error.code, "Photo Upload");
				console.log("upload error source " + error.source);
				console.log("upload error target " + error.target);
				deleteFile(filename);
			};
			var ft = new FileTransfer();
			ft.upload(filename, model.webserviceRoot + url, success, fail, options);
		},
		function(data) {
		},
		{
			quality: 40, 
			destinationType: Camera.DestinationType.FILE_URI, 
			correctOrientation: true,
			targetWidth: 1080,
			targetHeight: 1080,
		});
	};
	
	this.addNote = function() {
		model.noteDraft('');
		model.editingNote(true);
	};
	
	this.sendNote = function() {
		var note = model.noteDraft();
		if (note !== '') {
			model.sendingNote(true);
			//$notebox.prop('disabled', true);
			var success = function(response) {
				model.sendingNote(false);
				model.noteDraft('');
				model.editingNote(false);
			};
			var fail = function(jqXHR, textStatus, e) {
				model.sendingNote(false);
				// TODO: probably the wrong status here... don't know if we even get here on connection failure
				model.prompt('There was a problem encountered while sending your note.  Check that you have a signal and a data connection', 'Notice', 'OK');
			};
			model.postNote(model.currentPo(), note, success, fail);
		}
	};
	
	this.cancelNote = function() {
		model.noteDraft('');
		model.editingNote(false);
	};
	
	this.lastPosition = ko.observable(false);
	this.onPositionUpdate = function(position) {
		var c = position.coords;
		var p = model.lastPosition() || {};
		if (!ON_DEVICE)
			c = { latitude: 39.97231, longitude: -104.83427, accuracy: 40.1 };
		p.latitude = c.latitude;
		p.longitude = c.longitude;
		p.accuracy = c.accuracy;
		p.at = new Date().getTime();
		console.log("Position: " + JSON.stringify(p));
		model.lastPosition(p);
	};

	this.filteredLocations = ko.computed(function() {
		var locs = this.locations.slice().filter(function(l) { return l.matchesFilter(model.searchText()); });
		var sorters = model.locationSorters.filter(function(q) { return q.id == model.currentSorter(); });
		locs.sort(sorters[0].func);
		return locs;
	}, model);
	

	function numberWithCommas(x) {
		var parts = x.toString().split(".");
		parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		return parts.join(".");
	}
	
	this.myDistanceTo = function(lat, long) {
		var p = model.lastPosition();
		if (!p)
			return -1;
		var x1 = long * Math.PI / 180;
		var y1 = lat * Math.PI / 180;
		var x2 = p.longitude * Math.PI / 180;
		var y2 = p.latitude * Math.PI / 180;
		var dx = x2 - x1;
		var dy = y2 - y1;
		var shdy = Math.sin(dy/2);
		var shdx = Math.sin(dx/2);
		var a = shdy * shdy + shdx * shdx * Math.cos(y1) * Math.cos(y2);
		var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return 6371000 * c;
	};
	
	this.formatDistance = function(meters) {
		if (meters == -1)
			return '?';
		var mi = meters * 0.000621504;
		var m = mi;
		var tenths = Math.floor((mi % 1) * 10);
		mi = "" + Math.floor(mi);
		if (mi.length > 2)
			return numberWithCommas(mi) + ' mi';
		else
			return mi + '.' + tenths + ' mi';
	};
	
	function PoManager() {
		var mgr = this;
		
		this.poByHash = {};
		this.poById = {};
		
		this.sendSyncRequest = function() {
			// Request PO data
			// TODO: show wait indicator
			
			// Do Sync
			// get hashes for current POs
			var hashes = [];
			var locs = model.locations();
			for (var i = 0; i < locs.length; i++) {
				var loc = locs[i];
				var pos = loc.pos();
				for (var j = 0; j < pos.length; j++) {
					var po = pos[j];
					hashes.push(po.hash);
				}
			}
			
			console.log("Sending sync request");
			
			model.postSync(hashes);
		};
		
		this.requestDbLoad = function() {
			var db = model.db();
			db.transaction(
				function(tx) {
					tx.executeSql('SELECT data FROM PURCHORD', [],
						function(tx, results) {
							var syncData = { minus: [], plus: [] };
							for (var i = 0; i < results.rows.length; i++) {
								var po = JSON.parse(results.rows.item(i).data);
								syncData.plus.push(po);
							}
							console.log("database read complete, applying...");
							mgr.sync(syncData);
							console.log("database read application complete");
						},
						function(err) {
							console.log("db get data failed: " + err);
						}
					);
				},
				function(err) {
					
				},
				function() {
					
				}
			);
		};
		
		this.sync = function (syncData) {
			// sync data is in two parts, "minus" and "plus".
			var results = { del: [], upd: [], ins: [] };
			
			// map location hashes to locations
			var locsByLocHash = {};
			for (var i = model.locations().length - 1; i >= 0; i--) {
				var loc = model.locations()[i];
				locsByLocHash[loc.lochash] = loc;
			}
			
			// remove old hashes
			for (var i = 0; i < syncData.minus.length; i++) {
				var hash = syncData.minus[i];
				delete this.poByHash[hash];
			}
			
			// process new+modified POs from sync data
			var plus = syncData.plus;
			for (var i = 0; i < plus.length; i++) {
				var syncPo = plus[i];
				var po;
				if (syncPo.id in this.poById) {
					// update existing PO
					po = this.poById[syncPo.id];
					model.map(model.maps.po, syncPo, po);
					this.poByHash[po.hash] = po;
					results.upd.push(syncPo);
					console.log('updated po ' + po.number);
				}
				else {
					// insert new PO
					po = {};
					model.map(model.maps.po, syncPo, po);
					this.poById[syncPo.id] = po;
					this.poByHash[syncPo.hash] = po;
					results.ins.push(syncPo);
					if (!(po.lochash in locsByLocHash)) {
						model.locations.push(locsByLocHash[po.lochash] = model.createLocation(po));
						console.log('added location ' + locsByLocHash[po.lochash].name);
					}
					var loc = locsByLocHash[po.lochash];
					// add PO to its location
					loc.pos.push(po);
					console.log('added po ' + po.number + ' with hash ' + syncPo.hash);
				}
			}

			// remove any POs whose hash no longer exists
			for (var poId in this.poById) {
				var po = this.poById[poId];
				if (!(po.hash in this.poByHash)) {
					delete this.poById[poId];
					results.del.push(poId);
					console.log('removed po ' + po.number + ', ' + po.hash + ' no longer exists');
				}
			}
			
			// also remove them from their locations, and remove empty locations
			for (var i = model.locations().length - 1; i >= 0; i--) {
				var loc = model.locations()[i];
				for (var j = loc.pos().length - 1; j >= 0; j--) {
					var po = loc.pos()[j];
					if (!(po.hash in this.poByHash)) {
						loc.pos.splice(j, 1);
						console.log('removed po ' + po.number + ' from loc');
						if (loc.pos().length === 0) {
							model.locations.splice(i, 1);
							console.log('removed loc ' + loc.name);
						}
					}
				}
			}
			
			return results;
		};
		
		this.updateDb = function(operations) {
			var db = model.db();
			db.transaction(
				function(tx) {
					for (var i = 0; i < operations.ins.length; i++) {
						var po = operations.ins[i];
						tx.executeSql('INSERT OR REPLACE INTO PURCHORD (id, data) VALUES (?, ?)', [po.id, JSON.stringify(po)]);
					}
					for (var i = 0; i < operations.upd.length; i++) {
						var po = operations.upd[i];
						tx.executeSql('INSERT OR REPLACE INTO PURCHORD (id, data) VALUES (?, ?)', [po.id, JSON.stringify(po)]);
					}
					for (var i = 0; i < operations.del.length; i++) {
						var id = operations.del[i];
						tx.executeSql('DELETE FROM PURCHORD WHERE id = ?', [id]);
					}
				},
				function(err) {
					console.log("db transaction failed: " + err);
				},
				function() {
				}
			);
		};
	};

	this.poManager = new PoManager();
	
	this.db = function() {
		if (!('dbhandle' in model)) {
			var db = model.dbhandle = window.openDatabase("localstore", "1.0", "Local Store", 1048576);
			db.transaction(function(tx) {
				tx.executeSql('CREATE TABLE IF NOT EXISTS PURCHORD (id unique, data)');
				tx.executeSql('CREATE TABLE IF NOT EXISTS TOKEN (token unique, expires)');
			},
			function(err) {
				console.log("db open failed: " + err);
			},
			function() {
				console.log("db opened");
			});
		}
		return model.dbhandle;
	};
	
	this.receiveSync = function(syncData) {
		console.log("Sync data received");
		var results = model.poManager.sync(syncData);
		model.poManager.updateDb(results);
	};
	
	this.createLocation = function(po) {
		var dist = model.myDistanceTo(po.latitude, po.longitude);
		var location = {
			hash: po.lochash,
			name: po.locName,
			address: po.locAddress,
			latitude: po.latitude,
			longitude: po.longitude,
			radius: po.radius,
			pos: ko.observableArray(),
		};
		location.dist = ko.computed(function() {
			return model.myDistanceTo(this.latitude, this.longitude)
		}, location);
		location.distance = ko.computed(function() {
			return model.formatDistance(this.dist());
		}, location);
		location.status = ko.computed(function() {
			if (!this.pos)
				return 'undefined';
			var pos = this.pos();
			if (pos.length == 1)
				return pos[0].status();
			else if (pos.length === 0)
				return 'closed';
			// if any PO is checked in, then the status is checked in
			// if all are closed, then status is closed
			var closed = true;
			for (var i = 0; i < pos.length; i++) {
				var po = pos[i];
				if (po.status() == 'checkedin')
					return 'checkedin';
			}
			for (var i = 0; i < pos.length; i++) {
				var po = pos[i];
				if (po.status() == 'reqauth')
					return 'reqauth';
			}
			for (var i = 0; i < pos.length; i++) {
				var po = pos[i];
				if (po.status() == 'reqfollowup')
					return 'reqfollowup';
			}
			for (var i = 0; i < pos.length; i++) {
				var po = pos[i];
				if (po.status() != 'closed')
					closed = false;
			}
			if (closed)
				return 'closed';
		}, location);
		location.matchesFilter = function(f) {
			if (typeof f === 'undefined' || f === '')
				return true;
			console.log('FILTER: ' + f);
			f = f.toLowerCase();
			for (var i = 0; i < this.pos().length; i++) {
				var po = this.pos()[i];
				if (po.number.toLowerCase().indexOf(f) != -1)
					return true;
			}
			if (-1 != this.name.toLowerCase().indexOf(f))
				return true;
			if (-1 != this.address.toLowerCase().indexOf(f))
				return true;
			return false;
		};
		return location;
	};
	
	this.refreshLocations = function() {
		model.doSync();
	};

	this.callSupport = function() {
		window.location.href = 'tel:513-252-3255';
	}
	
	this.selectLocation = function(location) {
		console.log("Select Location: " + location.name);
		model.currentLocation(location);
		var pos = model.currentLocation().pos();
		if (pos.length == 1)
			model.currentPo(pos[0]);
	};
	
	this.checkin = function() {
		model.currentPo().status('checkedin');
		model.currentPo(null);
		var screen = Screens.pop();
	};
	
	this.completeJob = function() {
		model.currentPo().status('closed');
		model.currentPo(null);
		var screen = Screens.pop();
	};
	
	this.incompleteJob = function() {
		model.currentPo().status('incomplete');
		model.currentPo(null);
		var screen = Screens.pop();
	};
	
	this.cancelLocation = function() {
		model.currentLocation(null);
	};

	this.cancelPo = function() {
		model.currentPo(null);
		if (model.currentLocation().pos().length == 1)
			model.currentLocation(null);
	}
	
	this.selectPo = function(po) {
		model.currentPo(po);
	};
	
	this.map = function(map, jso, modelo) {
		var rules = map.rules;
		var stat = map['static'];
		for (var prop in jso) {
			if (prop in rules) {
				var rule = rules[prop];
				if (typeof(rule) == "function")
					rule.call(modelo, jso[prop]);
				else if (typeof(rule) == "string")
					modelo[rule] = jso[prop];
			}
			else {
				modelo[prop] = jso[prop];
			}
		}
		for (var s in stat) {
			if (!(s in modelo))
				modelo[s] = stat[s];
		}
	};

	this.maps = {
		po: {
			'static': {
			},
			'rules': {
				'status': function (val) { if (!this.status) { this.status = ko.observable(val); } else { this.status(val); }},
			},
		},
	};
}

/*
Screens.define({
	details: {
		initialize: function(e, model) {
			$sliderdiv = $('#checkinout');
			if (model.currentPo().status() == 'closed') {
				$sliderdiv.hide();
			}
			else {
				var slider = new Slider($sliderdiv);
				slider.direction(model.currentPo().status() == 'checkedin' ? 1 : -1);
				var statuses = ['closed', 'reqauth', 'reqfollowup'];
				slider.setEndOptions(1, ['Job Complete', 'Requires Authorization', 'Follow-up Required']);
				slider.onSlid = function(direction, option) {
					var isCheckin = direction == -1;
					if (isCheckin) {
						slider.disableWith("Checking in...");
						var success = function() {
							slider.enable();
							slider.direction(-direction);
						}
						var fail = function() {
							slider.disableWith("Checkin failed");
							model.prompt('There was a problem encountered while trying to checkin.  Please check your signal and data connection and try again', 'Notice', 'OK');
							slider.direction(direction);
							slider.enable();
						}
						model.checkinCurrentPo(success, fail)
					}
					else {
						var status = statuses[option.index];
						slider.disableWith("Checking out...");
						var success = function(syncData) {
							slider.enable();
							if (model.currentPo().status == 'closed')
								$sliderdiv.hide();
							slider.direction(-direction);
						}
						var fail = function(jqXHR, textStatus, e) {
							slider.disableWith("Checkout failed");
							model.prompt('There was a problem encountered while trying to checkout.  Please check your signal and data connection and try again', 'Notice', 'OK');
							slider.enable();
							slider.direction(direction);
						}
						model.checkoutCurrentPo(status, success, fail);
					}
				}
			}
		},
		back: function() {
			return Screens.pop();
		}
	},
	polist: {
		initialize: function(element, data) {
		},
		back: function() {
			return Screens.pop();
		},
	},
	login: {
		activate: function(model) {
		},
		initialize: function(element, model) {
		}
	}
});
*/

Handlebars.registerHelper('hasMultiple', function(item, options) {
	return (item.length && item.length > 1) ? options.fn(this) : options.inverse(this);
});

Handlebars.registerHelper('getStatus', function(item, options) {
	if (item.length == 1)
		return item[0].status;
});

//  format an ISO date using Moment.js
//  http://momentjs.com/
//  moment syntax example: moment(Date("2011-07-18T15:50:52")).format("MMMM YYYY")
//  usage: {{dateFormat creation_date format="MMMM YYYY"}}
Handlebars.registerHelper('dateFormat', function(context, block) {
  if (window.moment) {
	var f = block.hash.format || "MMM Do, YYYY";
	return moment(Date(context)).format(block.hash.format || "MMM Do, YYYY");
  }
  else {
	return context;   //  moment plugin not available. return data as is.
  }
});

function switchToPng() {
	style = document.createElement('style');
	$style = $(style);
	$style.attr('type', 'text/css');
	var sss = document.styleSheets;
	expr = /\/img\/svg\/(.*?)\.svg/g;
	var overrides = '';
	for (var i = 0; i < sss.length; i++) {
		var ss = sss[i];
		for (var j = 0; j < ss.cssRules.length; j++) {
			var rule = ss.cssRules[j];
			var text = rule.cssText;
			if (expr.test(text)) {
				text = text.replace(expr, "/img/gen/$1.png");
				overrides += text + '\n';
			}
		}
	}
	$style.html(overrides);
	$('head').append($style);
}

var init = function() {
	console.log("device ready");
	var model = new ViewModel();

	var startBackground = function() {
		console.log("START BG");
		if (!model.bgsync)
			model.bgsync = setInterval(function() { model.doSync(); }, 900000);
		if (!model.bggps) {
			model.bggps = navigator.geolocation.watchPosition(
				function(position) {
					model.onPositionUpdate(position);
				},
				function() {
					// TODO: add indicator for bad GPS
				},
				{ maximumAge: 180000, enableHighAccuracy: true }
			);
		}
		model.doSync();
	};

	var stopBackground = function() {
		console.log("STOP BG");
		navigator.geolocation.clearWatch(model.bggps);
		delete model.bggps;
		clearInterval(model.bgsync);
		delete model.bgsync;
	};

	var onbackbutton = function() {
		console.log("DEVICE BACK BUTTON");
		if (model.editingNote())
			return model.cancelNote();
		if (model.currentPo())
			return model.cancelPo();
		if (model.currentLocation())
			return model.cancelLocation();
		stopBackground();
		navigator.app.exitApp();
	};

	// detect and handle android 2 (lack of svg)
	model.needPng = 'device' in window && device.platform.toLowerCase() == 'android' && device.version.substring(0, 1) == '2';
	if (model.needPng)
		switchToPng();
	document.addEventListener('backbutton', onbackbutton, false);
	document.addEventListener('pause', stopBackground, false);
	document.addEventListener('resume', startBackground, false);
	ko.applyBindings(model, document.getElementById('application'));
	model.poManager.requestDbLoad();
	model.doAppAuth(function() { model.initializing(false); });
	startBackground();
};

if (ON_DEVICE)
	document.addEventListener('deviceready', init, false);
else
	$(document).ready(init);


ko.bindingHandlers.fade = {
	init: function(element, valueAccessor) {
		var visible = ko.utils.unwrapObservable(valueAccessor());
		$(element).css('display', visible ? 'auto' : 'none');
	},
	update: function(element, valueAccessor) {
		var visible = ko.utils.unwrapObservable(valueAccessor());
		if (visible)
			$(element).fadeIn();
		else
			$(element).fadeOut();
	},
};

ko.bindingHandlers.input = {
	init: function(input, valueAccessor) {
		var b = valueAccessor();
		if (ko.isObservable(b) && !b.isComputed)
			$(input).on('input', function() { b(this.value); });
	},
	update: function(input, valueAccessor) {
		var v = ko.utils.unwrapObservable(valueAccessor());
		if (v !== input.value)
			input.value = v;
	},
};

ko.bindingHandlers.Sorter = {
	init: function(element, valueAccessor) {
		var sorter = new Sorter(element);
		var bindings = valueAccessor();
		for (var propname in bindings) {
			var binding = bindings[propname];
			if (ko.isObservable(binding) && !binding.isComputed) {
				sorter.onchange(propname, function(newval) {
					binding(newval);
				});
			}
		}
	},
	update: function(element, valueAccessor) {
		var sorter = $(element).data('control');
		var bindings = valueAccessor();
		for (var propname in bindings) {
			var binding = bindings[propname];
			var val = ko.utils.unwrapObservable(binding);
			if (val !== sorter[propname]())
				sorter[propname](val);
		}
	},
};

ko.bindingHandlers.Slider = {
	init: function(element, valueAccessor) {
		var slider = new Slider(element);
		var bindings = valueAccessor();
		for (var propname in bindings) {
			slider.bind(propname, bindings[propname]);
		}
	},
	update: function(element, valueAccessor) {
		var slider = $(element).data('control');
		var bindings = valueAccessor();
		for (var propname in bindings) {
			var binding = bindings[propname];
			console.log('PROPNAME: ' + propname + ', ' + (typeof binding) + ', ' + (typeof slider));
			var val = ko.utils.unwrapObservable(binding);
			if (typeof slider[propname] === 'function' && val !== slider[propname]())
				slider[propname](val);
		}
	},
}

}());

