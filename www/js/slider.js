function touchCoords(e) {
	var c = e;
	if ('originalEvent' in c)
		c = c.originalEvent;
	if ('targetTouches' in c)
		c = c.targetTouches[0];
	return c;
}

function Slider($div) {
	var control = this;
	this.grabbed = false;
	this.endOptions = {};
	this.optionsMode = false; // true when dragging vertically for options
	this.currentOption = null;

	this.grabHandle = function(e) {
		if (control.disabled)
			return;
		console.log('slider grabbed');
		control.grabbed = true;
		control.$div.addClass('grabbed');
		var c = touchCoords(e); 
		control.grab = { originX: c.pageX, originY: c.pageY };
		control.dragWidth = control.calcDragWidth();
	}
	
	this.calcDragWidth = function() { return control.$div.width() - control.$handle.outerWidth(); };
	
	this.handleComplete = function(d, option) {
		control.onSlid(d, option);
	}
	
	this.ungrabHandle = function() {
		console.log('slider ungrabbed');
		control.$div.removeClass('grabbed');
		control.grabbed = false;
		if (control.atMax) {
			var d = control.direction();
			if (control.optionsMode) {
				var option = control.currentOption;
				control.exitOptionsMode();
				if (option) {
					control.handleComplete(d, option)
				}
			}
			else {
				control.handleComplete(d, option);
			}
		}
		delete control.grab;
		if (!control.disabled)
			control.moveHandle(0);
	}
	
	this.dragHandle = function(e) {
		e.preventDefault();
		var c = touchCoords(e);
		if (control.optionsMode) {
			var dy = c.pageY - control.grab.originY;
			dy = control.clampHandleY(dy);
			control.moveHandleY(dy);
		}
		else {
			var dx = c.pageX - control.grab.originX;
			dx = dx * control.dir;
			var dy = c.pageY - control.grab.originY;
			if (Math.abs(dy) > control.$handle.height() * 2.8) {
				control.ungrabHandle();
				return;
			}
			dx = control.clampHandle(dx);
			control.moveHandle(dx);
			control.atMax = dx == control.dragWidth;
			if (control.atMax) {
				var d = control.direction();
				var eo = control.endOptions[d];
				if (eo && eo.length) {
					control.showOptions(eo);
				}
			}
		}
	}
	
	this.showOptions = function(o) {
		if (!control.optionsMode)
			control.enterOptionsMode(o);
	}
	
	this.disableWith = function(message) {
		if (!control.disabled) {
			control.disabled = true;
			control.$div.addClass('disabled');
			control.$caption.css('opacity', 1);
		}
		control.disableMessage = message;
		control.updateCaption();
		if (control.grabbed)
			control.ungrabHandle();
	}
	
	this.enable = function() {
		control.disabled = false;
		control.$div.removeClass('disabled');
		control.disableMessage = null;
		control.updateCaption();
		if (!control.grabbed)
			control.moveHandle(0);
	}
	
	this.enterOptionsMode = function(o) {
		control.optionsMode = true;
		control.normalHeight = control.$div.height();
		var activeOptions = [];
		var $list = $('<div class="optionlist"/>');
		var side = control.direction() == 1 ? 'right' : 'left';
		$list.addClass(side);
		for (var i = 0; i < o.length; i++) {
			var otext = o[i];
			var opt = {};
			opt.text = otext;
			opt.$div = $('<div class="option"/>');
			opt.$div.text(otext);
			$list.append(opt.$div);
			activeOptions.push(opt);
		}
		for (var i = 0; i < activeOptions.length; i++)
			activeOptions[i].index = i;
		control.$div.prepend($list);
		//$list.css('bottom', control.normalHeight + 'px');
		var newHeight = control.normalHeight + $list.height();
		control.$div.addClass('optionsmode');
		control.$optionsList = $list;
		control.activeOptions = activeOptions;
		control.animating = true;
		control.$div.animate({height: newHeight + 'px'}, 200, 'swing', function() {
			control.animating = false;
			if (control.optionsMode) {
				control.$div.height(newHeight);
				control.dragHeight = control.$div.height() - control.$handle.outerHeight();
			}
			else {
				control.$div.height(control.normalHeight);
			}
		});
		//control.$div.height();
	}
	
	this.exitOptionsMode = function() {
		control.moveHandleY(0);
		control.optionsMode = false;
		control.$div.height(control.normalHeight);
		control.$optionsList.remove();
		control.$div.removeClass('optionsmode');
		control.currentOption = null;
		delete control.activeOptions;
	}
	
	this.moveHandle = function(dx) {
		var tx = (control.dir == 1) ? dx : control.dragWidth - dx;
		control.$handle.css('-webkit-transform', 'translate3d(' + tx + 'px,0,0)');
		var opacity = 45 - Math.abs(dx);
		if (opacity < 0)
			opacity = 0;
		var d = control.dir;
		if (Math.abs(dx) > Math.abs(control.dragWidth / 2))
			d = -d;
		control.$caption.css('marginLeft', d == 1 ? control.$handle.width() : 0);
		control.$caption.css('marginRight', d == -1 ? control.$handle.width() : 0);
		control.$caption.css('opacity', opacity / 45); 
	}
	
	this.moveHandleY = function(dy) {
		var dx = control.direction() == 1 ? control.dragWidth : 0;
		control.$handle.css('-webkit-transform', 'translate3d(' + dx + 'px, ' + dy + 'px,0)');
		// try to see which option is current
		var y = dy + control.$div.height() - (control.$handle.outerHeight() / 2);
		var currentOption = null;
		if (!control.animating) {
			for (var i = 0; i < control.activeOptions.length; i++) {
				var o = control.activeOptions[i];
				var top = control.activeOptions[i].$div.position().top;
				var bottom = top + control.activeOptions[i].$div.outerHeight();
				if (y >= top && y < bottom)
					(currentOption = control.activeOptions[i]).$div.addClass('current');
				else
					control.activeOptions[i].$div.removeClass('current');
			}
		}
		control.currentOption = currentOption;
	}
	
	this.clampHandle = function(dx) {
		if (dx < 0)
			dx = 0;
		if (dx > control.dragWidth)
			dx = control.dragWidth;
		return dx;
	}
	
	this.clampHandleY = function(dy) {
		if (dy > 0)
			dy = 0;
		if (dy < -control.dragHeight)
			dy = -control.dragHeight;
		return dy;
	}
	
	this.direction = function(b) {
		if (b && control.dir != b) {
			control.dir = b;
			control.updateCaption();
			control.dragWidth = control.calcDragWidth();
			control.moveHandle(0);
			var eo = control.endOptions[b];
			var hasOptions = eo && eo.length;
			if (hasOptions)
				control.$div.addClass('hasoptions');
			else
				control.$div.removeClass('hasoptions');
		}
		return control.dir;
	}
	
	this.updateCaption = function() {
		if (control.disabled)
			control.$caption.text(control.disableMessage);
		else
			control.$caption.text(control.$div.data(control.dir == 1 ? 'left' : 'right'))
	}
	
	this.setEndOptions = function(forDirection, options) {
		control.endOptions[forDirection] = options;
	}
	
	// add a slide handle
	$handle = $('<div class="handle"/>');
	
	$caption = $('<div class="caption"/>');
	
	$div.append($caption);
	$caption.css('position', 'relative');
	
	$handle.touchstart(function(e) { if (!control.grabbed) { control.grabHandle(e); } });
	$handle.touchend(function() { if (control.grabbed) { control.ungrabHandle(); } });
	$(document).touchmove(function(e) { if (control.grabbed) { control.dragHandle(e); } });
	$(document).touchend(function() { if (control.grabbed) { control.ungrabHandle(); } });
	
	$div.append($handle);
	
	this.$div = $div;
	this.$handle = $handle;
	this.$caption = $caption;
	this.direction($div.data('direction') == "reverse" ? -1 : 1);
	$caption.css('top', (($div.height() - $caption.height()) / 2) + 'px');
}
