var ON_DEVICE = document.URL.indexOf('http://') === -1;

function ViewModel() {
	var model = this; 
	this.locations = ko.observableArray();
	
	this.selectionStack = [];
	this.currentLocation = ko.observable();
	this.currentPo = ko.observable();
	this.overallStatus = ko.computed(function() {
		var locs = this.locations();
		if (!locs || locs.length == 0)
			return '';
		for (var i = 0; i < locs.length; i++) {
			var loc = locs[i];
			if (loc.status() == 'checkedin')
				return 'checkedin';
		}
		return '';
	}, model);
	
	if (ON_DEVICE) {
		this.webserviceRoot = 'http://10.10.11.6:82/ServiceVerificationApp.svc';
	}
	else {
		this.webserviceRoot = '/test/webservice/ServiceVerificationApp.svc';
	}
	
	this.logout = function() {
		var db = model.db();
		db.transaction(
			function(tx) {
				tx.executeSql('DELETE FROM TOKEN', [],
					function(tx, results) {
					},
					function(err) {
						console.log("db store auth data failed: " + err);
					}
				)
			},
			function(err) {
				console.log("db store auth data failed: " + JSON.stringify(err));
			},
			function() {
			}
		);
		model.doLoginScreen();
	}
	
	this.onAuthenticate = function(token, expires) {
		model.token = token;
		var db = model.db();
		db.transaction(
			function(tx) {
				tx.executeSql('INSERT INTO TOKEN (token, expires) VALUES (?, ?)', [token, expires],
					function(tx, results) {
					},
					function(err) {
						console.log("db store auth data failed: " + err);
					}
				)
			},
			function(err) {
				console.log("db store auth data failed: " + JSON.stringify(err));
			},
			function() {
			}
		);
	}

	
	this.login = function() {
		var $form = $('#loginform');
		var $logo = $('#loginlogo');
		
		var login = $('#loginbox').val();
		var password = $('#passwordbox').val();
		
		if (login == "") {
			alert("Please enter a login");
			return;
		}
		
		if (password == "") {
			alert("Please enter a password");
			return;
		}

		$form.fadeOut("fast", function() {
			var success = function(token, expires) {
				model.onAuthenticate(token, expires)
				model.doMainActivity();
			}
			var fail = function(message) {
				alert(message);
				$logo.fadeOut("fast", function() {
				});
				$form.css('visibility', 'visible');
				$form.fadeIn();
			}
			try {
				$req = $.ajax({
					type: 'POST',
					url: model.webserviceRoot + '/auth/' + login,
					contentType: 'application/json; charset=UTF-8',
					timeout: 5000,
					dataType: 'json',
					data: JSON.stringify({ Password: password }),
					success: function(data) {
						if (data.status == "Authorized") {
							success(data.token, data.expires);
						}
						else {
							if (data.status == "Authorization failed")
								fail("Authorization failed, please try again");
							else
								fail(data.status);
						}
					},
					error: function(jqXHR, textStatus) {
						if (textStatus == "error")
							fail("There was an unexpected problem processing this login request.  Please try again");
						else if (textStatus == "timeout")
							fail("Unable to reach the server, do you have signal and a data connection?");
						else
							fail("There was an unexpected problem processing this login request.  Please try again.  (Status = '" + textStatus + "')");
						},
					});
			}
			catch (e) {
				fail("There was an unexpected problem processing this login request.  Please try again.  (Problem = '" + e.message + "')");
			}
		});
		$logo.css('visibility', 'visible');
		$logo.fadeIn();
	}
	
	this.doMainActivity = function() {
		Screens.replace('locations', model);
	}
	
	this.doAppAuth = function() {
		var db = model.db();
		var expiry = (new Date().getTime() / 1000) + 60;
		db.transaction(
			function(tx) {
				tx.executeSql('SELECT token FROM TOKEN WHERE expires > ? ORDER BY expires DESC', [expiry],
					function(tx, results) {
						if (results.rows.length > 0)
							model.token = results.rows.item(0).token;
						if (model.token)
							model.doMainActivity();
						else
							model.doLoginScreen();
						return false;
					},
					function(err) {
						console.log("db get auth data failed: " + err);
						model.doLoginScreen();
					}
				)
			},
			function(err) {
				console.log("db get auth data failed: " + JSON.stringify(err));
				model.doLoginScreen();
			},
			function() {
				
			}
		);
	}
	
	this.doLoginScreen = function() {
		console.log('doLoginScreen');
		Screens.replace('login', model);
	}
	
	this.lastPosition = false;
	this.onPositionUpdate = function(position) {
		var c = position.coords;
		if (!model.lastPosition)
			model.lastPosition = {};
		var p = model.lastPosition;
		if (!ON_DEVICE) {
			c = { latitude: 39.97231, longitude: -104.83427, accuracy: 40.1 };
		}
		p.latitude = c.latitude;
		p.longitude = c.longitude;
		p.accuracy = c.accuracy;
		console.log(c);
		
		for (var i = model.locations().length - 1; i >= 0; i--) {
			var loc = model.locations()[i];
			loc.dist = model.myDistanceTo(loc.latitude, loc.longitude);
			loc.distance(model.formatDistance(loc.dist));
		}
		
		model.sortLocations();
	}
	
	this.locationSorters = {
		'sort_by_cust': function(a,b) { return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); },
		'sort_by_dist': function(a,b) { return a.dist == b.dist ? 0 : (a.dist < b.dist ? -1 : 1); },
	}
	
	this.selectSort = function(sorter) {
		$sortbox = $("#" + sorter);
		$sortbox.addClass("sortbox_current");
		if ('previousSort' in model && model.previousSort != sorter)
			$("#" + model.previousSort).removeClass("sortbox_current");
		model.previousSort = sorter;
		model.currentSorter = model.locationSorters[sorter];
		model.sortLocations();
	}
	
	this.sortLocations = function() {
		model.locations.sort(model.currentSorter);
	}
	
	function numberWithCommas(x) {
	    var parts = x.toString().split(".");
	    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	    return parts.join(".");
	}
	
	this.myDistanceTo = function(lat, long) {
		var p = model.lastPosition;
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
	}
	
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
	}
	
	this.poManager = new function() {
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
			
			$req = $.ajax({
				type: 'POST',
				url: model.webserviceRoot + '/' + model.token + '/purchaseorders/sync',
				contentType: 'application/json; charset=UTF-8',
				dataType: 'json',
				data: JSON.stringify({ Hashes: hashes }),
				success: function(data) {
						// TODO: hide wait indicator
						model.receiveSync(data);
					},
				error: function(jqXHR, textStatus) {
						// TODO: hide wait indicator
						// TODO: do something about the problem here
					},
				});
		}
		
		this.refresh = function() {
			// Load data from database
			model.poManager.requestDbLoad(mgr.sendSyncRequest);
			mgr.refresh = mgr.sendSyncRequest; // only load from db the first time
		}

		this.requestDbLoad = function(oncomplete) {
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
							mgr.sync(syncData);
							if (oncomplete)
								oncomplete();
						},
						function(err) {
							console.log("db get data failed: " + err);
						}
					)
				},
				function(err) {
					
				},
				function() {
					
				}
			);
		}
		
		this.sync = function (syncData) {
			// sync data is in two parts, "minus" and "plus".
			results = { del: [], upd: [], ins: [] };
			
			// map location hashes to locations
			var locsByLocHash = {};
			for (var i = model.locations().length - 1; i >= 0; i--) {
				var loc = model.locations()[i];
				locsByLocHash[loc.lochash] = loc;
			}
			
			// process new+modified POs from sync data
			var plus = syncData.plus;
			for (var i = 0; i < plus.length; i++) {
				var syncPo = plus[i];
				if (syncPo.id in this.poById) {
					// update existing PO
					var po = this.poById[syncPo.id];
					model.map(model.maps.po, syncPo, po);
					this.poByHash[po.hash] = po;
					results.upd.push(syncPo);
					console.log('updated po ' + po.number);
				}
				else {
					// insert new PO
					var po = {};
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
					console.log('added po ' + po.number);
				}
			}

			// remove old hashes
			for (var i = 0; i < syncData.minus.length; i++) {
				var hash = syncData.minus[i];
				delete this.poByHash[hash];
			}
			
			// remove any POs whose hash no longer exists
			for (var poId in this.poById) {
				var po = this.poById[poId];
				if (!(po.hash in this.poByHash)) {
					delete this.poById[poId];
					results.del.push(poId);
					console.log('removed po ' + po.number);
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
						if (loc.pos().length == 0) {
							model.locations.splice(i, 1);
							console.log('removed loc ' + loc.name);
						}
					}
				}
			}
			
			model.sortLocations();
			
			return results;
		}
		
		this.updateDb = function(operations) {
			var db = model.db();
			for (var i = 0; i < operations.ins.length; i++) {
				var po = operations.ins[i];
				db.transaction(function(tx) {
					tx.executeSql('INSERT OR REPLACE INTO PURCHORD (id, data) VALUES (?, ?)', [po.id, JSON.stringify(po)]);
				},
				function(err) {
					console.log("db insert failed: " + err);
				},
				function() {
				})
			}
			for (var i = 0; i < operations.upd.length; i++) {
				var po = operations.upd[i];
				db.transaction(function(tx) {
					tx.executeSql('INSERT OR REPLACE INTO PURCHORD (id, data) VALUES (?, ?)', [po.id, JSON.stringify(po)]);
				},
				function(err) {
					console.log("db update failed: " + err);
				},
				function() {
				})
			}
			for (var i = 0; i < operations.del.length; i++) {
				var id = operations.del[i];
				db.transaction(function(tx) {
					tx.executeSql('DELETE FROM PURCHORD WHERE id = ?', [id]);
				},
				function(err) {
					console.log("db delete failed: " + err);
				},
				function() {
				})
			}
		}
	}
	
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
			})
		}
		return model.dbhandle;
	}
	
	this.receiveSync = function(syncData) {
		var results = model.poManager.sync(syncData);
		model.poManager.updateDb(results);
	}
	
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
			dist: dist,
			distance: ko.observable(model.formatDistance(dist)),
		};
		location.status = ko.computed(function() {
			if (!this.pos)
				return 'undefined';
			var pos = this.pos();
			if (pos.length == 1)
				return pos[0].status();
			else if (pos.length == 0)
				return 'closed';
			// if any PO is checked in, then the status is checked in
			// if all are closed, then status is closed
			var closed = true;
			for (var i = 0; i < pos.length; i++) {
				var po = pos[i];
				if (po.status() == 'checkin')
					return 'checkin';
			}
			for (var i = 0; i < pos.length; i++) {
				var po = pos[i];
				if (po.status() == 'incomplete')
					return 'incomplete';
			}
			for (var i = 0; i < pos.length; i++) {
				var po = pos[i];
				if (po.status() != 'closed')
					closed = false;
			}
			if (closed)
				return 'closed';
		}, location);
		return location;
	}
	
	this.refreshLocations = function() {
		model.poManager.refresh();
	}
	
	this.selectLocation = function(location) {
		model.currentLocation(location);
		var pos = model.currentLocation().pos();
		var poCount = pos.length; 
		if (poCount == 1) {
			model.selectPo(pos[0]);
		}
		else {
			var screen = Screens.push('polist');
			screen.cancel = function() {
				model.currentLocation(null);
			}
		}
	}
	
	this.checkin = function() {
		model.currentPo().status('checkedin');
		model.currentPo(null);
		var screen = Screens.pop();
	}
	
	this.completeJob = function() {
		model.currentPo().status('closed');
		model.currentPo(null);
		var screen = Screens.pop();
	}
	
	this.incompleteJob = function() {
		model.currentPo().status('incomplete');
		model.currentPo(null);
		var screen = Screens.pop();
	}
	
	this.cancel = function() {
		var screen = Screens.pop();
		screen.cancel();
	}
	
	this.selectPo = function(po) {
		model.currentPo(po);
		var screen = Screens.push('details');
		screen.cancel = function() {
			model.currentPo(null);
		}
	}
	
	this.map = function(map, jso, modelo) {
		var rules = map['rules'];
		var stat = map['static'];
		for (prop in jso) {
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
		for (s in stat) {
			if (!(s in modelo))
				modelo[s] = stat[s];
		}
	}

	this.maps = {
		po: {
			'static': {
			},
			'rules': {
				'status': function (val) { if (!this.status) { this.status = ko.observable(val); } else { this.status(val); }},
			},
		},
	};
};

Screens.define({
	locations: {
		initialize: function(e, model) {
			// Setup Search Box
			$searchbox = $("#searchbox");
			$searchbox.focus(function() {
				if (!this.unempty)
					this.value = "";
				$searchbox.removeClass("prompt");
			});
			$searchbox.change(function() {
				this.unempty = this.value != "";
			});
			$searchbox.blur(function() {
				if (!this.unempty) {
					this.value = "enter PO number";
					$searchbox.addClass("prompt");
				}
			});
			
			
			// Setup sorters
			// Select sort-by-distance as default
			model.selectSort("sort_by_dist");
			// Setup event handler for changing sort
			$(".sortbox").touchstart(function() {
				model.selectSort(this.id);
			});
			
			model.poManager.refresh();
			
			navigator.geolocation.watchPosition(function(position) {
				model.onPositionUpdate(position);
			}, function() {
				// TODO: add indicator for bad GPS
			}, { frequency: 3000, maximumAge: 60000, timeout: 60000, enableHighAccuracy: true });
		}
	},
	checkedin : {
		initialize: function() {
		},
	},
	details: {
		initialize: function() {
			var slider = new Slider($('#checkinout'));
			slider.setEndOptions(1, ['Job Complete', 'Requires Authorization', 'Follow-up Required']);
			slider.onSlid = function() {
				if (slider.direction() == -1) {
					slider.direction(1);
				}
				else {
					return false;
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
		initialize: function(element, model) {
			var $page = $('#loginpage');
			var $area = $('#loginarea');
			$area.css({ 'top': ($page.width() * 0.3) + 'px' });

			// preload image
			var $logo = $('<div id="loginlogo"/>'); 
			$img = $('<img/>');
			$img[0].src = 'img/login-logo.png';
			$logo.append($img);
			$logo.css('visibility', 'hidden');
			$logo.hide();
			$area.append($logo);
			
			// add the login form
			var $form = $('<div id="loginform"/>');
			$form.append($('#html_loginform').html());
			$area.append($form);
		}
	}
});

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
  }else{
    return context;   //  moment plugin not available. return data as is.
  };
});

// For some reason, this is needed to make buttons appear "activated" when tapped
$(document).on('touchstart', function(e) {
});

var init = function() {
	console.log("ready");
	Screens.init();
	var model = new ViewModel();
	model.doAppAuth();
}

if (ON_DEVICE)
	document.addEventListener('deviceready', init, false);
else
	$(document).ready(init);
