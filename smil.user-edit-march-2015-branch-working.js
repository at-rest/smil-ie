/*jshint browser: true*/
/*jshint sub: true*/

/*
@id {7eeff186-cfb4-f7c3-21f2-a15f210dca49}
@name FakeSmile
@version 0.1.55
@description SMIL implementation in ECMAScript
@creator David Leunen (leunen.d@gmail.com)
@homepageURL http://leunen.me/fakesmile/
@ff_min_version 2.0
@ff_max_version 3.*
*/
// ==UserScript==
// @name smil
// @namespace svg.smil
// ==/UserScript==

/* MIT and GPL Licenses */

/*
Copyright 2008 David Leunen
Copyright 2012 Helder Magalhaes
Copyright 2014 Trevor Rees
*/

/**
 * Milliseconds Per Frame - relation between animation smoothness and resources usage:
 * 83 for ~12fps (standard quality web animation; low CPU usage; slightly jumpy; recommended for discrete or slow-motion animations);
 * 67 for ~15fps (high quality web animation; reasonable resources usage; recommended for most use-cases);
 * 40 for  25fps ("cine"-look; recommended for good quality animations on television systems);
 * 33 for ~30fps (half LCD refresh rate; recommended for high quality animations on desktop systems);
 * 25 for  40fps (very smooth animation; recommended for high quality animations on dedicated desktop systems);
 * 17 for ~60fps (LCD refresh rate; high CPU and system overhead; only recommended for very high quality animations running on high-end systems).
 * References:
 * http://animation.about.com/od/faqs/f/faq_fpsnumber.htm
 * http://en.wikipedia.org/wiki/Frame_rate#Frame_rates_in_film_and_television
 */
var mpf = 33;
var splinePrecision = 25;

var svgns = "http://www.w3.org/2000/svg";
var smilanimns = "http://www.w3.org/2001/smil-animation";
var smil2ns = "http://www.w3.org/2001/SMIL20";
var smil21ns = "http://www.w3.org/2005/SMIL21";
var smil3ns = "http://www.w3.org/ns/SMIL30";
var timesheetns = "http://www.w3.org/2007/07/SMIL30/Timesheets";
var xlinkns = "http://www.w3.org/1999/xlink";

var animators = []; // array of all animations each represented by an Animator object
// var id2anim = {}; // id -> animation elements (workaround a Gecko bug)
var runningAnimation = []; // array of running animators
var timeZero;

// Change notes: 28/03/2015 
//  color property on animator determined by element attribute eg fill
// .freezed > .final ?? still to determine impact
// observation: normalize appears to act on every calculation - better to normalize start and finish only?
// ... except where necessary

/**
 * If declarative animations are not supported,
 * the document animations are fetched and registered.
 */
function initSMIL() {

    // test for internet explorer

    if (document.implementation.hasFeature(smil3ns, "3.0")) {
        return;
    }


    /** checking for nested svg?
     */

    if (document.documentElement.getAttribute("smiling") == "fake") {
        return;
    }
    document.documentElement.setAttribute("smiling", "fake");
    smile(document);

    timeZero = new Date();
    // I schedule them (after having instanciating them, for sync-based events)
    // (it doesn't work either: first 0s animation don't trigger begin event to the following -> make it asynchronous)
    for (var i = 0, l = animators.length; i < l; ++i) {
        animators[i].register();

        // starts the rendering loop
        window.setInterval(animate, mpf);
    }
}

function smile(document) {
    var request = null;
    //var animates = []; // DOM nodes 
    var node_animations = document.querySelectorAll("animate , animateMotion , animateTransform , animateColor , set");
    var i; // for loop iterator
    var l; // array length

    for (i = 0, l = node_animations.length; i < l; ++i) {
        var targets = getTarget(node_animations[i]);
        // elAnimators: local array
        var elAnimators = [];
        for (var index = 0; index < targets.length; ++index) {
            var target = targets[index];
            var animator = new Animator(node_animations[i], target, index);
            animators.push(animator);
            elAnimators[index] = animator;
        }
        // write array of animator instances (Animator object) to list of document animations
        // replaces animation.animators = elAnimators; 
        // where anim = animates.item(i); where animates = animating.getElementsByTagName("*");
        // used in function getEventTargetsById
        node_animations[i]["animators"] = elAnimators;
        // var id = animation.getAttribute("id");
        // if (id) {
        //     id2anim[id] = anim;
    }
}

function getTarget(element) {
        // animation definitions may not target more than one element
        // an element may possess more than one animation
        if (element.hasAttribute("select"))
            return select(element);
        // animation defined in <defs> tag
        var href = element.getAttributeNS(xlinkns, "href");
        if (href !== null && href !== "")
            return [document.getElementById(href.substring(1))];
        else {
            // animation defined within element tag
            var target = element.parentNode;
            if (target.localName == "item" && (target.namespaceURI == timesheetns || target.namespaceURI == smil3ns))
                return select(target);
            return [target];
        }
    }
    // timesheets dropped
    //function select(element) {
    //    var selector = element.getAttribute("select");
    //    var parent = element.parentNode;
    //   while (parent && parent.nodeType == 1) {
    //        if (parent.localName == "item" && (parent.namespaceURI == timesheetns || parent.namespaceURI == smil3ns))
    //           selector = parent.getAttribute("select") + " " + selector;
    //      parent = parent.parentNode;
    //   }
    //    return document.querySelectorAll(selector);
    //}

function getEventTargetsById(id, ref) {
    var element = null;
    if (id == "prev") {
        element = ref.previousSibling;
        while (element && element.nodeType != 1)
            element = element.previousSibling;
    }
    if (element === null)
        element = document.getElementById(id);
    // Gecko now supports SMIL
    //if (element === null)
    //    element = id2anim[id]; // because getElementById doesn't returns SMIL elements in Gecko
    if (element === null)
        return null;
    if (element.animators)
        return element.animators;
    return [element];
}


/**
 * Corresponds to one <animate>, <set>, <animateTransform>, ...
 * (there can be more than one Animator for each element)
 */
Animator.prototype = {

    /**
     * Registers the animation.
     * It schedules the beginnings and endings.
     */
    register: function () {
        var begin = this.animation.getAttribute("begin");
        if (!begin)
            begin = "0";
        this.schedule(begin, this.begin);
        var end = this.animation.getAttribute("end");
        if (end)
            this.schedule(end, this.finish);
    },

    /**
     * Schedules the starts or ends of the animation.
     */
    schedule: function (timeValueList, func) {
        var me = this; // I do that because if I use "this", the addEventListener understands the event source
        var timeValues = timeValueList.split(";");
        for (var i = 0; i < timeValues.length; ++i) {
            var time = timeValues[i].trim();
            if (time.length > 11 && time.substring(0, 10) == "wallclock(") {
                var wallclock = new Date();
                wallclock.setISO8601(time.substring(10, time.length - 1));
                var now = new Date();
                var diff = wallclock - now;
                func.call(me, diff);
            } else if (isNaN(parseInt(time, 10))) {
                var offset = 0;
                var io = time.indexOf("+");
                if (io == -1)
                    io = time.indexOf("-");
                if (io != -1) {
                    offset = toMillis(time.substring(io).replace(/ /g, ""));
                    time = time.substring(0, io).trim();
                }
                io = time.indexOf(".");
                var elements = [];
                if (io == -1) {
                    elements = [this.target];
                } else {
                    var id = time.substring(0, io);
                    if (id.indexOf("index(") === 0)
                        id = id.substring(6, id.length - 1) + this.index;
                    elements = getEventTargetsById(id, this.anim);
                }
                var event = time.substring(io + 1);
                var call = funk(func, me, offset);
                for (var j = 0; j < elements.length; ++j) {
                    var element = elements[j];
                    if (element === null)
                        continue;
                    element.addEventListener(event, call, false);
                }
            } else {
                time = toMillis(time);
                func.call(me, time);
            }
        }
    },

    /**
     * Remembers the initial value of the animated attribute.
     * This function is overridden.
     */
    getCurVal: function () {
        if (this.attributeType == "CSS") {
            // should use this.target.getPresentationAttribute instead
            // march 2015: getPresentationAttribute is deprecated
            // getPropertyValue for >ie9
            return this.target.style.getPropertyValue(this.attributeName);
        } else {
            //var animAtt = this.target[this.attributeName];
            //if (animAtt && animAtt["animVal"])
            //	return animAtt["animVal"].value;
            //else
            return this.target.getAttributeNS(this.namespace, this.attributeName);
        }
    },

    /**
     * Starts the animation.
     * I mean the very beginning of it.
     * Not called when repeating.
     *
     * from, to, by and value are assigned to animVals array
     * assigned values are normalised first
     *
     *routine restructured so color normalisation routine is active before existing normalisation call
     *
     */
    begin: function (offset) {
        var i = 0,
            len = 0;
        if (this.restart == "never" || (this.running && this.restart == "whenNotActive"))
            return;
        if (this.running)
            this.finish();
        // First timer
        if (offset !== null && offset >= 0) {
            var me = this;
            var myself = this.begin;
            var call = function () {
                myself.call(me);
            };
            window.setTimeout(call, offset);
            return;
        }
        this.startTime = new Date();
        if (offset && offset < 0) {
            this.startTime.setTime(this.startTime.getTime() + offset);
            if (this.startTime < timeZero)
                return;
        }
        // ? Remove this animation from the running array
        this.stop();
        this.running = true;
        var initVal = this.getCurVal();
        this.realInitVal = initVal;
        // TODO
        // I should get the Inherited value here (getPresentationAttribute is not supported)
        //~~~
        // query element for default value

        if (!initVal && propDefaults[this.attributeName]){
            initVal = propDefaults[this.attributeName];}
          //  initVal = getDefault[this.attributeName];}

        if (this.attributeName.match(/^(fill|stroke|stop-color|flood-color|lighting-color)$/)) {
            /**  set normalisation routine for color values
             properties that take colour values ‘fill’, ‘stroke’, 
             ‘stop-color’, ‘flood-color’, ‘lighting-color’
             http://www.w3.org/TR/SVG/propidx.html
             */
            this.color();
        }

        // process animation types - create array animVals: base and destination(s)

        // SET
        if (this.animation.nodeName == "set")
        // set accepts only single final value
            this.writeVal(this.normalize(this.to));
        this.iteration = 0;
        // VALUES
        if (this.values) {
            // array asignment by default - type coercion
            this["animVals"] = this.values.split(";");
            for (i = 0; i < this["animVals"].length; ++i)
                this["animVals"][i] = this.normalize(this["animVals"][i].trim());
        }
        // FROM | TO | BY
        else {
            this["animVals"] = [];
            if (this.from)
                this["animVals"][0] = this.normalize(this.from);
            else
            // default FROM value
            // ? regular checks for this["animVals"][0] assign by default value where initVal is null/undefined
                this["animVals"][0] = this.normalize(initVal);
            // BY
            if (this.by && this["animVals"][0])
                this["animVals"][1] = this.add(this.normalize(this["animVals"][0]), this.normalize(this.by));
            else
            // TO
                this["animVals"][1] = this.normalize(this.to);
        }
        // Final position
        if (this["animVals"][this["animVals"].length - 1]) {
            this.final = this["animVals"][this["animVals"].length - 1];

            if (this["animVals"][0]) {
                // check for color animation: hash, color name list, 6+ rgb(a) (TODO: opacity) value 

                if (!this.attributeName.match(/^(fill|stroke|stop-color|flood-color|lighting-color)$/)) {
                    // ?? check and set / balance units
                    var cp = [];
                    var oneVal = this["animVals"][0];
                    var qualified = getUnit(oneVal);
                    cp[0] = qualified[0];
                    this.unit = qualified[1];
                    for (i = 1, len = this["animVals"].length; i < len; ++i) {
                        oneVal = this["animVals"][i];
                        qualified = getUnit(oneVal);
                        if (qualified[1] == this.unit)
                            cp[i] = qualified[0];
                        else {
                            cp = this["animVals"];
                            break;
                        }
                    }
                    this["animVals"] = cp;
                }
            }
        }

        this.iterBegin = this.startTime;
        runningAnimation.push(this);
        for (i = 0, len = this.beginListeners.length; i < len; ++i)
            this.beginListeners[i].call();
        var onbegin = this.animation.getAttribute("onbegin");
        if (onbegin)
            eval(onbegin);
    },

    /**
     * This function is overridden for multiple values attributes (scale, rotate, translate).
     */
    normalize: function (value) {
        return value;
    },

    /**
     * Sums up two normalized values.
     */
    add: function (a, b) {
        return "" + (parseFloat(a) + parseFloat(b));
    },

    /**
     * Computes and applies the animated value for a given time.
     * Returns false if this animation has been stopped (removed from the running array).
     */
    f: function (curTime) {
        var animation = this.animation;

        var dur = this.computedDur;
        if (isNaN(dur))
            return true;

        var beginTime = this.iterBegin;

        var diff = curTime - beginTime;
        var percent = diff / dur;
        if (percent >= 1)
            return this.end();

        var iteration = parseFloat(this.iteration);
        if (this.repeatCount && this.repeatCount != "indefinite" && (iteration + percent) >= this.repeatCount) {
            if (this.fill == "freeze")
                this.final = this.valueAt(this.repeatCount - iteration);
            return this.end();
        }
        if (this.repeatDur && this.repeatDur != "indefinite" && (curTime - this.startTime) >= toMillis(this.repeatDur)) {
            if (this.fill == "freeze") {
                var div = toMillis(this.repeatDur) / dur;
                this.final = this.valueAt(div - Math.floor(div));
            }
            return this.end();
        }

        if (animation.localName == "set")
            return true;

        var curVal = this.valueAt(percent);

        this.writeVal(curVal);
        return true;
    },

    isInterpolable: function (from, to) {
        var areN = (!isNaN(from) && !isNaN(to));
        if (!areN && from.trim().indexOf(" ") != -1 && to.trim().indexOf(" ") != -1) {
            var tfrom = from.trim().split(" ");
            var tto = to.trim().split(" ");
            areN = true;
            if (tfrom.length == tto.length)
                for (var i = 0; i < tto.length; ++i)
                    if (!this.isInterpolable(tfrom[i], tto[i]))
                        return false;
        }
        return areN;
    },

    valueAt: function (percent) {
        var tValues = this["animVals"],
            i = 0,
            len = 0,
            parts = 0;
        if (percent == 1)
            return tValues[tValues.length - 1];
        if (this.calcMode == "discrete" || !this.isInterpolable(tValues[0], tValues[1])) {
            if (this.keyTimes) {
                for (i = 1; i < this.keyTimes.length; ++i)
                    if (this.keyTimes[i] > percent)
                        return tValues[i - 1];
                return tValues[tValues.length - 1];
            }
            parts = tValues.length;
            var div = Math.floor(percent * parts);
            return tValues[div];
        } else {
            var index;
            if (this.keyTimes) {
                for (i = 1; i < this.keyTimes.length; ++i)
                    if (this.keyTimes[i] > percent) {
                        index = i - 1;
                        var t1 = this.keyTimes[index];
                        percent = (percent - t1) / (this.keyTimes[i] - t1);
                        break;
                    }
            } else {
                parts = tValues.length - 1;
                index = Math.floor(percent * parts);
                percent = (percent % (1 / parts)) * parts;
            }
            if (this.calcMode == "spline")
                percent = this.spline(percent, index);
            //return this.interpolate(this.normalize(tValues[index]), this.normalize(tValues[index + 1]), percent);
            return this.interpolate(tValues[index], tValues[index + 1], percent);
        }
    },

    spline: function (percent, index) {
        var path = this.keySplines[index];
        var tot = path.getTotalLength();
        var step = tot / splinePrecision;
        var pt = 0,
            pt1 = 0;
        for (var i = 0; i <= tot; i += step) {
            pt = path.getPointAtLength(i);
            if (pt.x > percent) {
                pt1 = path.getPointAtLength(i - step);
                percent -= pt1.x;
                percent /= pt.x - pt1.x;
                return pt1.y + ((pt.y - pt1.y) * percent);
            }
        }
        pt = path.getPointAtLength(tot);
        pt1 = path.getPointAtLength(tot - step);
        percent -= pt1.x;
        percent /= pt.x - pt1.x;
        return pt1.y + ((pt.y - pt1.y) * percent);
    },

    /**
     * Performs the interpolation.
     * This function is overridden.
     */
    interpolate: function (from, to, percent) {
        if (!this.isInterpolable(from, to)) {
            if (percent < 0.5)
                return from;
            else
                return to;
        }
        if (from.trim().indexOf(" ") != -1) {
            var tfrom = from.split(" ");
            var tto = to.split(" ");
            var ret = [];
            for (var i = 0; i < tto.length; ++i)
                ret[i] = parseFloat(tfrom[i]) + ((tto[i] - tfrom[i]) * percent);
            return ret.join(" ");
        }
        return parseFloat(from) + ((to - from) * percent);
    },

    /**
     * Apply a value to the attribute the animator is linked to.
     * This function is overridden.
     */
    writeVal: function (value) {
        if (this.unit)
            value += this.unit;
        var attributeName = this.attributeName;
        var attributeType = this.attributeType;
        if (attributeType == "CSS") {
            // workaround a Gecko and WebKit bug
           // if (attributeName == "font-size" && !isNaN(value))
           //     value += "px";
            this.target.style.setProperty(this.attributeName, value, "");
        } else {
            //var animAtt = this.target[attributeName];
            //if (animAtt && animAtt["animVal"])
            //	animAtt["animVal"].value = value;
            //else
            this.target.setAttributeNS(this.namespace, attributeName, value);
        }
    },

    /**
     * Normal end of the animation:
     * it restarts if repeatCount.
     */
    end: function () {
        var i = 0;
        if (!this.repeatCount && !this.repeatDur)
            return this.finish();
        else {
            ++this.iteration;
            var now = new Date();
            if (this.repeatCount && this.repeatCount != "indefinite" && this.iteration >= this.repeatCount)
                return this.finish();
            else if (this.repeatDur && this.repeatDur != "indefinite" && (now - this.startTime) >= toMillis(this.repeatDur))
                return this.finish();
            else {
                if (this.accumulate == "sum") {
                    var curVal = this.getCurVal();
                    if (!curVal && propDefaults[this.attributeName])
                        curVal = propDefaults[this.attributeName];

                    if (this.by && !this.from) {
                        this["animVals"][0] = curVal;
                        //this["animVals"][1] = this.add(this.normalize(curVal), this.normalize(this.by));
                        this["animVals"][1] = this.add(curVal, this.by);
                    } else {
                        for (i = 0; i < this["animVals"].length; ++i)
                         //   this["animVals"][i] = this.add(this.normalize(curVal), this.normalize(this["animVals"][i]));
                        this["animVals"][i] = this.add(curVal, this["animVals"][i]);
                    }
                    this.final = this["animVals"][this["animVals"].length - 1];
                }
                this.iterBegin = now;
                for (i = 0; i < this.repeatIterations.length; ++i) {
                    if (this.repeatIterations[i] == this.iteration)
                        this.repeatListeners[i].call();
                }
                var onrepeat = this.animation.getAttribute("onrepeat");
                if (onrepeat)
                    eval(onrepeat);
            }
        }
        return true;
    },

    /**
     * Really stop of the animation (it doesn't repeat).
     * Freezes or removes the animated value.
     */
    finish: function (offset) {
        var now = new Date();
        if (this.min && this.min != "indefinite") {
            //			now = new Date();
            if ((now - this.startTime) >= toMillis(this.min))
                return true;
        }
        if (offset && offset > 0) {
            var me = this;
            var myself = this.finish;
            var call = function () {
                myself.call(me);
            };
            window.setTimeout(call, offset);
            return true;
        }
        if (offset && offset < 0) {
            //			now = new Date();
            now.setTime(now.getTime() + offset);
            if (now < this.startTime)
                return true;
        }

        var fill = this.fill;
        var kept = true;
        if (fill == "freeze") {
            this.freeze();
        } else {
            this.stop();
         //   this.writeVal(this.realInitVal);
            this.writeVal(this.realInitVal);
            kept = false;
        }
        if (this.running) {
            for (var i = 0; i < this.endListeners.length; ++i)
                this.endListeners[i].call();
            var onend = this.animation.getAttribute("onend");
            if (onend)
                eval(onend);
            this.running = false;
        }
        return kept;
    },

    /**
     * Removes this animation from the running array.
     */
    stop: function () {
        for (var i = 0, j = runningAnimation.length; i < j; ++i)
            if (runningAnimation[i] == this) {
                runningAnimation.splice(i, 1);
                break;
            }
    },

    /**
     * Freezes the attribute value to the ending value.
     */
    freeze: function () {
        this.writeVal(this.final);
    },

    /**
     * Adds a listener to this animation beginning or ending.
     */
    addEventListener: function (event, func, b) {
        if (event == "begin")
            this.beginListeners.push(func);
        else if (event == "end")
            this.endListeners.push(func);
        else if (event.length > 7 && event.substring(0, 6) == "repeat") {
            var iteration = event.substring(7, event.length - 1);
            this.repeatListeners.push(func);
            this.repeatIterations.push(iteration);
        }
    },

    /**
     * Returns the path linked to this animateMotion.
     */
    getPath: function () {
        var mpath = this.animation.getElementsByTagNameNS(svgns, "mpath")[0];
        if (mpath) {
            var pathHref = mpath.getAttributeNS(xlinkns, "href");
            return document.getElementById(pathHref.substring(1));
        } else {
            var d = this.animation.getAttribute("path");
            if (d) {
                var pathEl = createPath(d);
                //pathEl.setAttribute("display", "none");
                //this.animation.parentNode.appendChild(pathEl);
                return pathEl;
            }
        }
        return null;
    },

    /**
     * Initializes this animator as a translation (x,y):
     * <animateTransform type="translate"> or
     * <animateMotion> without a path.
     */
    translation: function () {
        if (this.by && this.by.indexOf(",") == -1)
            this.by = this.by + ",0";
        this.normalize = function (value) {
            var coords = value.replace(/,/g, " ").replace(/ +/, " ").split(/ /);
            if (coords.length == 1)
                coords[1] = "0";
            //coords[1] = this.initVal.split(",")[1];
            coords[0] = parseFloat(coords[0]);
            coords[1] = parseFloat(coords[1]);
            return coords;
        };
        this.add = function (a, b) {
            var x = a[0] + b[0];
            var y = a[1] + b[1];
            return x + "," + y;
        };
        this.isInterpolable = function (from, to) {
            return true;
        };
        this.interpolate = function (from, to, percent) {
            var x = from[0] + ((to[0] - from[0]) * percent);
            var y = from[1] + ((to[1] - from[1]) * percent);
            return x + "," + y;
        };
    },

    /**
     * Initializes this animator as a color animation:
     * <animateColor> or
     * <animate> on a color attribute.
     */
    color: function () {
        this.isInterpolable = function (from, to) {
            return true;
        };
        this.interpolate = function (from, to, percent) {
            var r = Math.round(from[0] + ((to[0] - from[0]) * percent));
            var g = Math.round(from[1] + ((to[1] - from[1]) * percent));
            var b = Math.round(from[2] + ((to[2] - from[2]) * percent));
            var val = "rgb(" + r + "," + g + "," + b + ")";
            return val;
        };
        this.normalize = function (value) {
            var rgb = toRGB(value);
            //    if (rgb === null)
            //        return toRGB(propDefaults[this.attributeName]);
            return rgb;
        };
        this.add = function (a, b) {
            var ret = [];
            for (var i = 0; i < a.length; ++i)
                ret.push(Math.min(a[i], 255) + Math.min(b[i], 255));
            return ret.join(",");
        };
    },

    d: function () {
        this.isInterpolable = function (from, to) {
            return true;
        };
        this.interpolate = function (from, to, percent) {
            var path = "";
            var listFrom = from.myNormalizedPathSegList;
            var listTo = to.myNormalizedPathSegList;
            var segFrom, segTo, typeFrom, typeTo;
            for (var i = 0; i < listFrom["numberOfItems"] && i < listTo["numberOfItems"]; ++i) {
                segFrom = listFrom.getItem(i);
                segTo = listTo.getItem(i);
                typeFrom = segFrom["pathSegType"];
                typeTo = segTo["pathSegType"];
                if (typeFrom == 1 || typeTo == 1)
                    path += " z ";
                else {
                    var x = segFrom["x"] + ((segTo["x"] - segFrom["x"]) * percent);
                    var y = segFrom["y"] + ((segTo["y"] - segFrom["y"]) * percent);
                    if (typeFrom == 2 || typeTo == 2)
                        path += " M ";
                    else if (typeFrom == 4 || typeTo == 4)
                        path += " L ";
                    else {
                        var x1 = segFrom["x1"] + ((segTo["x1"] - segFrom["x1"]) * percent);
                        var y1 = segFrom["y1"] + ((segTo["y1"] - segFrom["y1"]) * percent);
                        var x2 = segFrom["x2"] + ((segTo["x2"] - segFrom["x2"]) * percent);
                        var y2 = segFrom["y2"] + ((segTo["y2"] - segFrom["y2"]) * percent);
                        path += " C " + x1 + "," + y1 + " " + x2 + "," + y2 + " ";
                    }
                    path += x + "," + y;
                }
            }
            return path;
        };
        this.normalize = function (value) {
            var path = createPath(value);
            return path;
        };
    }

};

/**
 * Constructor:
 * - initializes
 * - gets the attributes
 * - corrects and precomputes some values
 * - specializes some functions
 */
/**
 * @constructor
 */
function Animator(node_animation, target, index) {
    var i = 0,
        len = 0;
    this.animation = node_animation;
    this.target = target;
    this.index = index;
    node_animation.targetElement = target;
    this.attributeType = node_animation.getAttribute("attributeType");
    this.attributeName = node_animation.getAttribute("attributeName");
    if (this.attributeType != "CSS" && this.attributeType != "XML") {
        // attributeType not specified, default stands for "auto"
        // "The implementation must first search through the list of CSS properties for a matching property name"
        // http://www.w3.org/TR/SVG11/animate.html#AttributeTypeAttribute
        if (propDefaults[this.attributeName] && this.target.style.getPropertyValue(this.attributeName))
            this.attributeType = "CSS";
        else
            this.attributeType = "XML";
    }
    if (this.attributeType == "XML" && this.attributeName) {
        this.namespace = null;
        var chColon = this.attributeName.indexOf(":");
        if (chColon != -1) {
            var prefix = this.attributeName.substring(0, chColon);
            this.attributeName = this.attributeName.substring(chColon + 1);
            var node = target;
            while (node && node.nodeType == 1) {
                var ns = node.getAttributeNS("http://www.w3.org/2000/xmlns/", prefix);
                if (ns) {
                    this.namespace = ns;
                    break;
                }
                node = node.parentNode;
            }
        }
    }

    if (this.attributeName == "d") {
        this.d();
    } else if (this.attributeName == "points") {
        this.isInterpolable = function (from, to) {
            return true;
        };
        this.interpolate = function (from, to, percent) {
            var ret = [];
            var xyFrom, xyTo, x, y;
            for (var i = 0; i < from.length && i < to.length; ++i) {
                xyFrom = from[i].split(",");
                xyTo = to[i].split(",");
                x = parseFloat(xyFrom[0]) + ((parseFloat(xyTo[0]) - xyFrom[0]) * percent);
                y = parseFloat(xyFrom[1]) + ((parseFloat(xyTo[1]) - xyFrom[1]) * percent);
                ret.push(x + "," + y);
            }
            return ret.join(" ");
        };
        this.normalize = function (value) {
            var ar = value.split(" ");
            for (var i = ar.length - 1; i >= 0; --i)
                if (ar[i] === "")
                    ar.splice(i, 1);
            return ar;
        };
    }
    this.from = node_animation.getAttribute("from");
    this.to = node_animation.getAttribute("to");
    this.by = node_animation.getAttribute("by");
    this.values = node_animation.getAttribute("values");
    if (this.values) {
        this.values = this.values.trim();
        if (this.values.substring(this.values.length - 1) == ";")
            this.values = this.values.substring(0, this.values.length - 1);
    }
    this.calcMode = node_animation.getAttribute("calcMode");
    this.keyTimes = node_animation.getAttribute("keyTimes");
    if (this.keyTimes) {
        this.keyTimes = this.keyTimes.split(";");
        for (i = 0, len = this.keyTimes.length; i < len; ++i)
            this.keyTimes[i] = parseFloat(this.keyTimes[i]);
        this.keyPoints = node_animation.getAttribute("keyPoints");
        if (this.keyPoints) {
            this.keyPoints = this.keyPoints.split(";");
            for (i = 0, len = this.keyPoints.length; i < len; ++i)
                this.keyPoints[i] = parseFloat(this.keyPoints[i]);
        }
    }
    this.keySplines = node_animation.getAttribute("keySplines");
    if (this.keySplines) {
        this.keySplines = this.keySplines.split(";");
        for (i = 0, this.keySplines.length; i < len; ++i)
            this.keySplines[i] = createPath("M 0 0 C " + this.keySplines[i] + " 1 1");
    }
    this.dur = node_animation.getAttribute("dur");
    if (this.dur && this.dur != "indefinite")
        this.computedDur = toMillis(this.dur);
    this.max = node_animation.getAttribute("max");
    if (this.max && this.max != "indefinite") {
        this.computedMax = toMillis(this.max);
        if (!isNaN(this.computedMax) && this.computedMax > 0 && (!this.computedDur || this.computedDur > this.computedMax))
            this.computedDur = this.computedMax;
    }
    this.min = node_animation.getAttribute("min");
    if (this.min) {
        this.computedMin = toMillis(this.min);
        if (!this.computedDur || this.computedDur < this.computedMin)
            this.computedDur = this.computedMin;
    }

    this.fill = node_animation.getAttribute("fill");
    this.type = node_animation.getAttribute("type");
    this.repeatCount = node_animation.getAttribute("repeatCount");
    this.repeatDur = node_animation.getAttribute("repeatDur");
    this.accumulate = node_animation.getAttribute("accumulate");
    this.additive = node_animation.getAttribute("additive");
    this.restart = node_animation.getAttribute("restart");
    if (!this.restart)
        this.restart = "always";

    this.beginListeners = [];
    this.endListeners = [];
    this.repeatListeners = [];
    this.repeatIterations = [];

    var nodeName = node_animation.localName;

    if (nodeName == "animateColor") {

        this.color();

    } else if (nodeName == "animateMotion") {

        // .target is SVGPathElement
        // .transform is attribute (key) of SVGAnimatedTransformList > returns the SVGAnimatedTransformList
        // ["animVal"] is built in property of SVGAnimatedTransformList object
        this.isInterpolable = function (from, to) {
            return true;
        };
        this.getCurVal = function () {
            var curTrans = this["target"]["transform"];
            if (curTrans && curTrans["animVal"]["numberOfItems"] > 0) {
                var transList = curTrans["animVal"];
                return decompose(transList.getItem(0).matrix, "translate");
            } else
                return "0,0";
        };
        this.path = this.getPath();
        if (this.path) {
            this.valueAt = function (percent) {
                var length = this.path.getTotalLength();
                var point = this.path.getPointAtLength(percent * length);
                return point.x + "," + point.y;
            };
        } else {
            this.translation();
        }
        this.freeze = function () {
            var val = this.valueAt(1);
            this.writeVal(val);
        };
        if (this.keyPoints && this.keyTimes) {
            this.pathKeyTimes = this.keyTimes;
            this.keyTimes = null;
            this.superValueAt = this.valueAt;
            this.valueAt = function (percent) {
                for (var i = 1; i < this.keyPoints.length; ++i) {
                    var fakePC = this.keyPoints[this.keyPoints.length - 1];
                    if (this.pathKeyTimes[i] > percent) {
                        var pt = this.keyPoints[i - 1];
                        if (this.calcMode == "discrete")
                            fakePC = pt;
                        else {
                            var t1 = this.pathKeyTimes[i - 1];
                            percent = (percent - t1) / (this.pathKeyTimes[i] - t1);
                            fakePC = pt + ((this.keyPoints[i] - pt) * percent);
                        }
                        break;
                    }
                }
                return this.superValueAt(fakePC);
            };
        }
        this.writeVal = function (value) {
          // ?? test - to uncomment:  var attributeName = this.attributeName;
            value = "translate(" + value + ")";
            this.target.setAttribute("transform", value);
        };

    } else if (nodeName == "animateTransform") {

        this.isInterpolable = function (from, to) {
            return true;
        };
        this.getCurVal = function () {
            var type = this.type;
            var curTrans = this.target.transform;
            if (curTrans && curTrans["animVal"]["numberOfItems"] > 0) {
                var transList = curTrans["animVal"];
                return decompose(transList.getItem(0).matrix, type);
            } else {
                if (type == "scale")
                    return "1,1";
                else if (type == "translate")
                    return "0,0";
                else if (type == "rotate")
                    return "0,0,0";
                else
                    return 0;
            }
        };

        if (this.type == "scale") {
            this.normalize = function (value) {
                value = value.replace(/,/g, " ");
                var coords = value.split(" ");
                if (coords.length == 1)
                    coords[1] = coords[0];
                coords[0] = parseFloat(coords[0]);
                coords[1] = parseFloat(coords[1]);
                return coords;
            };
            this.add = function (a, b) {
                var ret = [];
                for (var i = 0; i < a.length; ++i)
                    ret.push(a[i] * b[i]);
                return ret.join(",");
            };
        } else if (this.type == "translate") {
            this.translation();
        } else if (this.type == "rotate") {
            this.normalize = function (value) {
                value = value.replace(/,/g, " ");
                var coords = value.split(" ");
                if (coords.length < 3) {
                    coords[0] = parseFloat(coords[0]);
                    coords[1] = 0;
                    coords[2] = 0;
                } else {
                    coords[0] = parseFloat(coords[0]);
                    coords[1] = parseFloat(coords[1]);
                    coords[2] = parseFloat(coords[2]);
                }
                return coords;
            };
            this.add = function (a, b) {
                var ret = [];
                for (var i = 0; i < a.length; ++i)
                    ret.push(a[i] + b[i]);
                return ret.join(",");
            };
        }

        if (this.type == "scale" || this.type == "rotate") {
            if (this.from)
                this.from = this.normalize(this.from).join(",");
            if (this.to)
                this.to = this.normalize(this.to).join(",");
            if (this.by)
                this.by = this.normalize(this.by).join(",");
            if (this.values) {
                var tvals = this.values.split(";");
                for (i = 0, len = tvals.length; i < len; ++i)
                    tvals[i] = this.normalize(tvals[i]).join(",");
                this.values = tvals.join(";");
            }
            this.interpolate = function (from, to, percent) {
                var ret = [];
                for (var i = 0; i < from.length; ++i)
                    ret.push(from[i] + ((to[i] - from[i]) * percent));
                return ret.join(",");
            };
        }

        this.writeVal = function (value) {
           // test - var attributeName = this.attributeName;
            value = this.type + "(" + value + ")";
            this.target.setAttribute(this.attributeName, value);
        };
    }

    var me = this;
    this.animation.beginElement = function () {
        me.begin();
        return true;
    };
    this.animation.beginElementAt = function (offset) {
        me.begin(offset * 1000);
        return true;
    };
    this.animation.endElement = function () {
        me.finish();
        return true;
    };
    this.animation.endElementAt = function (offset) {
        me.finish(offset * 1000);
        return true;
    };

    this.animation.getStartTime = function () {
        return parseFloat(me.iterBegin - timeZero) / 1000;
    };
    this.animation.getCurrentTime = function () {
        var now = new Date();
        return parseFloat(now - me.iterBegin) / 1000;
    };
}


/**
 * Can be called at any time.
 * It's the main loop.
 */
function animate() {
    var curTime = new Date();
    for (var i = 0, j = runningAnimation.length; i < j; ++i) {
        try {
            if (!runningAnimation[i].f(curTime)) {
                // animation was removed therefore we need to adjust both the iterator and the auxiliary variable
                --i;
                --j;
            }
        } catch (exc) {
            if (exc.message !== "Component returned failure code: 0x80004005 (NS_ERROR_FAILURE) [nsIDOMSVGPathElement.getTotalLength]") {
                // NOTE: in IE, console object is only available when Developer tools are open
                if (window.console && console.log) {
                    console.log(exc);
                } else {
                    alert(exc);
                }
            }
        }
    }
    // it would be cool if the attributes would be computed only, in the previous loop
    // and then the last values applied after the loop
    // for that, f(t) must return the value, and we must have a map for object(?).attributeType.attributeName -> value
    // then f(t) cannot return false when autostopping -> we must find another mechanism
}


/**
 * Converts a clock-value to milliseconds.
 * Supported: "s" | "ms" | "min" | "h" | no-units
 */
function toMillis(time) {
    time = time.trim();
    var len = time.length;
    var io = time.indexOf(":");

    if (io != -1) {
        var clockVal = time.split(":");
        len = clockVal.length;
        time = 0;
        if (clockVal.length == 3)
            time += parseInt(clockVal[0], 10) * 3600000;
        time += parseInt(clockVal[len - 2], 10) * 60000;
        time += parseFloat(clockVal[len - 1]) * 1000;
    } else if (len > 2 && time.substring(len - 2) == "ms") {
        time = time.substring(0, time.length - 2);
    } else if (len > 1 && time.substring(len - 1) == "s") {
        time = time.substring(0, time.length - 1);
        time = time * 1000;
    } else if (len > 3 && time.substring(len - 3) == "min") {
        time = time.substring(0, time.length - 3);
        time = time * 60000;
    } else if (len > 1 && time.substring(len - 1) == "h") {
        time = time.substring(0, time.length - 1);
        time = time * 3600000;
    } else {
        time = time * 1000;
    }
    return parseFloat(time);
}


/**
 * Decompose a matrix into its scale, translate, rotate or skew.
 */
function decompose(matrix, type) {
    if (type == "translate")
        return matrix.e + "," + matrix.f;

    var a = matrix.a;
    var b = matrix.b;
    var c = matrix.c;
    var d = matrix.d;

    if (type == "rotate")
        return Math.atan2(c, a) + ",0,0";

    var ModA = Math.sqrt(a * a + c * c);
    var ModB = Math.sqrt(b * b + d * d);

    if (type == "scale") {
        var AxB = a * d - b * c;
        var scaleX = AxB === 0 ? 0 : (AxB / ModA);
        var scaleY = ModB;
        return scaleX + "," + scaleY;
    }
    var AdotB = a * b + c * d;
    var shear = Math.PI / 2 - Math.acos(AdotB === 0 ? 0 : (AdotB / (ModB * ModA)));
    return (shear * 180) / Math.PI;
}


/**
 * Convert an rgb(), #XXX, #XXXXXX or named color
 * into an [r,g,b] array.
 */
function toRGB(color) {
    // ?? RGBA ??
    // check for color name here
    // getstyle / getcomputedstyle
    var rgb = [];

    // check for named color first - process returned rgb
    if (typeof color !== "string") {
        // ? already normalised
        //console.log("Error: in function toRGB, string expected");
        return color;
    }

    if (color.substring(0, 3) !== "rgb" && color.charAt(0) !== "#") {
        
        var get_color = document.documentElement.getElementById("smil-ie-g_colour");
        if (get_color === null) {
            get_color = document.createElementNS("http://www.w3.org/2000/svg", "g");
                // ? use timestamp to ensure id is unique
                get_color.setAttribute("id", "smil-ie-g_colour");
                document.documentElement.appendChild(get_color);
                get_color = document.documentElement.getElementById("smil-ie-g_colour");}

        if (getComputedStyle !== 'undefined') {
            // style must be assigned to live element and be a CSS value ie fill does not work
            get_color.style.color = color;
            color = getComputedStyle(get_color, null).getPropertyValue("color");
        }

    }
    // ? ie8 - doesn't suport getComputedStyle but does not natively support SVG - ?ASV
    // else {
    //     get_color = this.attributeName.currentStyle["color"];
    //    color = rgb;

    // RGB color
    if (color.substring(0, 3) == "rgb") {
        color = color.replace(/ /g, "");
        color = color.replace("rgb(", "");
        color = color.replace(")", "");
        rgb = color.split(",");
        for (var i = 0; i < rgb.length; ++i) {
            var len = rgb[i].length - 1;
            if (rgb[i].substring(len) == "%")
                rgb[i] = Math.round((rgb[i].substring(0, len)) * 2.55);
            else
                rgb[i] = parseInt(rgb[i], 10);
        }
        return rgb;
    }

    // HEX color
    else if (color.charAt(0) == "#") {

        color = color.trim();
        if (color.length == 7) {
            rgb[0] = parseInt(color.substring(1, 3), 16);
            rgb[1] = parseInt(color.substring(3, 5), 16);
            rgb[2] = parseInt(color.substring(5, 7), 16);
        } else {
            rgb[0] = color.substring(1, 2);
            rgb[1] = color.substring(2, 3);
            rgb[2] = color.substring(3, 4);
            rgb[0] = parseInt(rgb[0] + rgb[0], 16);
            rgb[1] = parseInt(rgb[1] + rgb[1], 16);
            rgb[2] = parseInt(rgb[2] + rgb[2], 16);
        }
        return rgb;
    }
}


function getDefault (attribute){
//var default = 
}


function createPath(d) {
    var path = document.createElementNS(svgns, "path");
    path.setAttribute("d", d);
    try {
        if (path.normalizedPathSegList)
            path.myNormalizedPathSegList = path.normalizedPathSegList;
    } catch (exc) {}
    if (!path.myNormalizedPathSegList) {
        // TODO : normalize the path
        path.myNormalizedPathSegList = path.pathSegList;
    }
    return path;
}


var units = ["grad", "deg", "rad", "kHz", "Hz", "em", "em", "px", "pt", "pc", "mm", "cm", "in", "ms", "s", "%"];

function getUnit(str) {
    if (str && str.substring) {
        for (var i = 0, j = units.length; i < j; ++i) {
            var vlen = str.length - units[i].length;
            if (vlen > 0 && str.substring(vlen) == units[i]) {
                var val = str.substring(0, vlen);
                if (!isNaN(val))
                    return [val, units[i]];
            }
        }
    }
    return [str, null];
}



var propDefaults = {
    font: "see individual properties",
    "font-family": "Arial",
    "font-size": "medium",
    "font-size-adjust": "none",
    "font-stretch": "normal",
    "font-style": "normal",
    "font-variant": "normal",
    "font-weight": "normal",
    direction: "ltr",
    "letter-spacing": "normal",
    "text-decoration": "none",
    "unicode-bidi": "normal",
    "word-spacing": "normal",
    clip: "auto",
    color: "depends on user agent",
    cursor: "auto",
    display: "inline",
    overflow: "hidden",
    visibility: "visible",
    "clip-path": "none",
    "clip-rule": "nonzero",
    mask: "none",
    opacity: 1,
    "enable-background": "accumulate",
    filter: "none",
    "flood-color": "black",
    "flood-opacity": 1,
    "lighting-color": "white",
    "stop-color": "black",
    "stop-opacity": 1,
    "pointer-events": "visiblePainted",
    "color-interpolation": "sRGB",
    "color-interpolation-filters": "linearRGB",
    "color-profile": "auto",
    "color-rendering": "auto",
    fill: "black",
    "fill-opacity": 1,
    "fill-rule": "nonzero",
    "image-rendering": "auto",
    "marker-end": "none",
    "marker-mid": "none",
    "marker-start": "none",
    "shape-rendering": "auto",
    stroke: "none",
    "stroke-dasharray": "none",
    "stroke-dashoffset": 0,
    "stroke-linecap": "butt",
    "stroke-linejoin": "miter",
    "stroke-miterlimit": 4,
    "stroke-opacity": 1,
    "stroke-width": 1,
    "text-rendering": "auto",
    "alignment-baseline": 0,
    "baseline-shift": "baseline",
    "dominant-baseline": "auto",
    "glyph-orientation-horizontal": 0,
    "glyph-orientation-vertical": "auto",
    kerning: "auto",
    "text-anchor": "start",
    "writing-mode": "lr-tb"
};

// ? colsure ?? what purpose? ? general factory closure generator ?

function funk(func, obj, arg) {
    return function () {
        func.call(obj, arg);
    };
}

/**
 * Removes the leading and trailing spaces chars from the string.
 * NOTE: part of ES5, so use feature detection
 * http://stackoverflow.com/questions/2308134/trim-in-javascript-not-working-in-ie/#2308157
 * NOTE: the regular expression used in fallback is placed in global namespace for performance
 * (as it's far better having a "singleton" than bloating every string instance)
 */
if (typeof String.prototype.trim !== "function") {
    window._trimRegExp = new RegExp("^\\s+|\\s+$", "g");
    String.prototype.trim = function () {
        return this.replace(window._trimRegExp, "");
    };
}

/**
 * Set an ISO 8601 timestamp to a Date object.
 * NOTE: as ES5 doesn't define precisely what "parse" should do, we run a sample to test for feasibility
 * http://stackoverflow.com/questions/2479714/does-javascript-ecmascript3-support-iso8601-date-parsing/#2481375
 * NOTE: the regular expression used in fallback is placed in global namespace for performance
 * (as it's far better having a "singleton" than bloating every date instance)
 */
if (!isNaN(Date.parse("2012-04-22T19:53:32Z"))) {
    // parse did well, use the native implementation
    Date.prototype.setISO8601 = function (string) {
        this.setTime(Date.parse(string));
    };
} else {
    window._setISO8601RegExp = new RegExp(
        "([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2})" +
        "(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]+))?)?" +
        "(?:Z|(([-+])([0-9]{2}):([0-9]{2})))?)?)?)?"
    );
    Date.prototype.setISO8601 = function (string) {
        var d = window._setISO8601RegExp.exec(string);

        var offset = 0;
        var date = new Date(d[1], 0, 1);

        if (d[2]) {
            date.setMonth(d[2] - 1);
        }
        if (d[3]) {
            date.setDate(d[3]);
        }
        if (d[4]) {
            date.setHours(d[4]);
        }
        if (d[5]) {
            date.setMinutes(d[5]);
        }
        if (d[6]) {
            date.setSeconds(d[6]);
        }
        // NOTE: ISO 8601 "decimal fraction of a second" needs to be converted to milliseconds
        if (d[7]) {
            date.setMilliseconds(parseFloat("0." + d[7]) * 1000);
        }
        if (d[8]) {
            offset = (parseInt(d[10]) * 60, 10) + parseInt(d[11], 10);
            offset *= ((d[9] == '-') ? 1 : -1);
        }
        offset -= date.getTimezoneOffset();
        this.setTime(date.getTime() + (offset * 60 * 1000));
    };
}

try {
    // NOTE: ASV skips triggering the library here, as 'addEventListener' is not supported
    // (but that's not an issue as most popular versions, ASV3 and ASV6 beta, both support SMIL)
    window.addEventListener("load", initSMIL, false);
} catch (exc) {}