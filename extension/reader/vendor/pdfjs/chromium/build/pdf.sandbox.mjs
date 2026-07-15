var __webpack_modules__ = {
    9306(module, __unused_webpack_exports, __webpack_require__) {
        var isCallable = __webpack_require__(4901);
        var tryToString = __webpack_require__(6823);
        var $TypeError = TypeError;
        module.exports = function(argument) {
            if (isCallable(argument)) return argument;
            throw new $TypeError(tryToString(argument) + " is not a function");
        };
    },
    8551(module, __unused_webpack_exports, __webpack_require__) {
        var isObject = __webpack_require__(34);
        var $String = String;
        var $TypeError = TypeError;
        module.exports = function(argument) {
            if (isObject(argument)) return argument;
            throw new $TypeError($String(argument) + " is not an object");
        };
    },
    9617(module, __unused_webpack_exports, __webpack_require__) {
        var toIndexedObject = __webpack_require__(5397);
        var toAbsoluteIndex = __webpack_require__(5610);
        var lengthOfArrayLike = __webpack_require__(6198);
        var createMethod = function(IS_INCLUDES) {
            return function($this, el, fromIndex) {
                var O = toIndexedObject($this);
                var length = lengthOfArrayLike(O);
                if (length === 0) return !IS_INCLUDES && -1;
                var index = toAbsoluteIndex(fromIndex, length);
                var value;
                if (IS_INCLUDES && el !== el) while (length > index) {
                    value = O[index++];
                    if (value !== value) return true;
                } else for (;length > index; index++) {
                    if ((IS_INCLUDES || index in O) && O[index] === el) return IS_INCLUDES || index || 0;
                }
                return !IS_INCLUDES && -1;
            };
        };
        module.exports = {
            includes: createMethod(true),
            indexOf: createMethod(false)
        };
    },
    4527(module, __unused_webpack_exports, __webpack_require__) {
        var DESCRIPTORS = __webpack_require__(3724);
        var isArray = __webpack_require__(4376);
        var $TypeError = TypeError;
        var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        var SILENT_ON_NON_WRITABLE_LENGTH_SET = DESCRIPTORS && !function() {
            if (this !== undefined) return true;
            try {
                Object.defineProperty([], "length", {
                    writable: false
                }).length = 1;
            } catch (error) {
                return error instanceof TypeError;
            }
        }();
        module.exports = SILENT_ON_NON_WRITABLE_LENGTH_SET ? function(O, length) {
            if (isArray(O) && !getOwnPropertyDescriptor(O, "length").writable) {
                throw new $TypeError("Cannot set read only .length");
            }
            return O.length = length;
        } : function(O, length) {
            return O.length = length;
        };
    },
    7680(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        module.exports = uncurryThis([].slice);
    },
    2195(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var toString = uncurryThis({}.toString);
        var stringSlice = uncurryThis("".slice);
        module.exports = function(it) {
            return stringSlice(toString(it), 8, -1);
        };
    },
    6955(module, __unused_webpack_exports, __webpack_require__) {
        var TO_STRING_TAG_SUPPORT = __webpack_require__(2140);
        var isCallable = __webpack_require__(4901);
        var classofRaw = __webpack_require__(2195);
        var wellKnownSymbol = __webpack_require__(8227);
        var TO_STRING_TAG = wellKnownSymbol("toStringTag");
        var $Object = Object;
        var CORRECT_ARGUMENTS = classofRaw(function() {
            return arguments;
        }()) === "Arguments";
        var tryGet = function(it, key) {
            try {
                return it[key];
            } catch (error) {}
        };
        module.exports = TO_STRING_TAG_SUPPORT ? classofRaw : function(it) {
            var O, tag, result;
            return it === undefined ? "Undefined" : it === null ? "Null" : typeof (tag = tryGet(O = $Object(it), TO_STRING_TAG)) == "string" ? tag : CORRECT_ARGUMENTS ? classofRaw(O) : (result = classofRaw(O)) === "Object" && isCallable(O.callee) ? "Arguments" : result;
        };
    },
    7740(module, __unused_webpack_exports, __webpack_require__) {
        var hasOwn = __webpack_require__(9297);
        var ownKeys = __webpack_require__(5031);
        var getOwnPropertyDescriptorModule = __webpack_require__(7347);
        var definePropertyModule = __webpack_require__(4913);
        module.exports = function(target, source, exceptions) {
            var keys = ownKeys(source);
            var defineProperty = definePropertyModule.f;
            var getOwnPropertyDescriptor = getOwnPropertyDescriptorModule.f;
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (!hasOwn(target, key) && !(exceptions && hasOwn(exceptions, key))) {
                    defineProperty(target, key, getOwnPropertyDescriptor(source, key));
                }
            }
        };
    },
    6699(module, __unused_webpack_exports, __webpack_require__) {
        var DESCRIPTORS = __webpack_require__(3724);
        var definePropertyModule = __webpack_require__(4913);
        var createPropertyDescriptor = __webpack_require__(6980);
        module.exports = DESCRIPTORS ? function(object, key, value) {
            return definePropertyModule.f(object, key, createPropertyDescriptor(1, value));
        } : function(object, key, value) {
            object[key] = value;
            return object;
        };
    },
    6980(module) {
        module.exports = function(bitmap, value) {
            return {
                enumerable: !(bitmap & 1),
                configurable: !(bitmap & 2),
                writable: !(bitmap & 4),
                value: value
            };
        };
    },
    6840(module, __unused_webpack_exports, __webpack_require__) {
        var isCallable = __webpack_require__(4901);
        var definePropertyModule = __webpack_require__(4913);
        var makeBuiltIn = __webpack_require__(283);
        var defineGlobalProperty = __webpack_require__(9433);
        module.exports = function(O, key, value, options) {
            if (!options) options = {};
            var simple = options.enumerable;
            var name = options.name !== undefined ? options.name : key;
            if (isCallable(value)) makeBuiltIn(value, name, options);
            if (options.global) {
                if (simple) O[key] = value; else defineGlobalProperty(key, value);
            } else {
                try {
                    if (!options.unsafe) delete O[key]; else if (O[key]) simple = true;
                } catch (error) {}
                if (simple) O[key] = value; else definePropertyModule.f(O, key, {
                    value: value,
                    enumerable: false,
                    configurable: !options.nonConfigurable,
                    writable: !options.nonWritable
                });
            }
            return O;
        };
    },
    9433(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var defineProperty = Object.defineProperty;
        module.exports = function(key, value) {
            try {
                defineProperty(globalThis, key, {
                    value: value,
                    configurable: true,
                    writable: true
                });
            } catch (error) {
                globalThis[key] = value;
            }
            return value;
        };
    },
    3724(module, __unused_webpack_exports, __webpack_require__) {
        var fails = __webpack_require__(9039);
        module.exports = !fails(function() {
            return Object.defineProperty({}, 1, {
                get: function() {
                    return 7;
                }
            })[1] !== 7;
        });
    },
    4055(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var isObject = __webpack_require__(34);
        var document = globalThis.document;
        var EXISTS = isObject(document) && isObject(document.createElement);
        module.exports = function(it) {
            return EXISTS ? document.createElement(it) : {};
        };
    },
    6837(module) {
        var $TypeError = TypeError;
        var MAX_SAFE_INTEGER = 9007199254740991;
        module.exports = function(it) {
            if (it > MAX_SAFE_INTEGER) throw new $TypeError("Maximum allowed index exceeded");
            return it;
        };
    },
    8727(module) {
        module.exports = [ "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf" ];
    },
    2839(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var navigator = globalThis.navigator;
        var userAgent = navigator && navigator.userAgent;
        module.exports = userAgent ? String(userAgent) : "";
    },
    9519(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var userAgent = __webpack_require__(2839);
        var process = globalThis.process;
        var Deno = globalThis.Deno;
        var versions = process && process.versions || Deno && Deno.version;
        var v8 = versions && versions.v8;
        var match, version;
        if (v8) {
            match = v8.split(".");
            version = match[0] > 0 && match[0] < 4 ? 1 : +(match[0] + match[1]);
        }
        if (!version && userAgent) {
            match = userAgent.match(/Edge\/(\d+)/);
            if (!match || match[1] >= 74) {
                match = userAgent.match(/Chrome\/(\d+)/);
                if (match) version = +match[1];
            }
        }
        module.exports = version;
    },
    6518(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var getOwnPropertyDescriptor = __webpack_require__(7347).f;
        var createNonEnumerableProperty = __webpack_require__(6699);
        var defineBuiltIn = __webpack_require__(6840);
        var defineGlobalProperty = __webpack_require__(9433);
        var copyConstructorProperties = __webpack_require__(7740);
        var isForced = __webpack_require__(2796);
        module.exports = function(options, source) {
            var TARGET = options.target;
            var GLOBAL = options.global;
            var STATIC = options.stat;
            var FORCED, target, key, targetProperty, sourceProperty, descriptor;
            if (GLOBAL) {
                target = globalThis;
            } else if (STATIC) {
                target = globalThis[TARGET] || defineGlobalProperty(TARGET, {});
            } else {
                target = globalThis[TARGET] && globalThis[TARGET].prototype;
            }
            if (target) for (key in source) {
                sourceProperty = source[key];
                if (options.dontCallGetSet) {
                    descriptor = getOwnPropertyDescriptor(target, key);
                    targetProperty = descriptor && descriptor.value;
                } else targetProperty = target[key];
                FORCED = isForced(GLOBAL ? key : TARGET + (STATIC ? "." : "#") + key, options.forced);
                if (!FORCED && targetProperty !== undefined) {
                    if (typeof sourceProperty == typeof targetProperty) continue;
                    copyConstructorProperties(sourceProperty, targetProperty);
                }
                if (options.sham || targetProperty && targetProperty.sham) {
                    createNonEnumerableProperty(sourceProperty, "sham", true);
                }
                defineBuiltIn(target, key, sourceProperty, options);
            }
        };
    },
    9039(module) {
        module.exports = function(exec) {
            try {
                return !!exec();
            } catch (error) {
                return true;
            }
        };
    },
    8745(module, __unused_webpack_exports, __webpack_require__) {
        var NATIVE_BIND = __webpack_require__(616);
        var FunctionPrototype = Function.prototype;
        var apply = FunctionPrototype.apply;
        var call = FunctionPrototype.call;
        module.exports = typeof Reflect == "object" && Reflect.apply || (NATIVE_BIND ? call.bind(apply) : function() {
            return call.apply(apply, arguments);
        });
    },
    616(module, __unused_webpack_exports, __webpack_require__) {
        var fails = __webpack_require__(9039);
        module.exports = !fails(function() {
            var test = function() {}.bind();
            return typeof test != "function" || test.hasOwnProperty("prototype");
        });
    },
    9565(module, __unused_webpack_exports, __webpack_require__) {
        var NATIVE_BIND = __webpack_require__(616);
        var call = Function.prototype.call;
        module.exports = NATIVE_BIND ? call.bind(call) : function() {
            return call.apply(call, arguments);
        };
    },
    350(module, __unused_webpack_exports, __webpack_require__) {
        var DESCRIPTORS = __webpack_require__(3724);
        var hasOwn = __webpack_require__(9297);
        var FunctionPrototype = Function.prototype;
        var getDescriptor = DESCRIPTORS && Object.getOwnPropertyDescriptor;
        var EXISTS = hasOwn(FunctionPrototype, "name");
        var PROPER = EXISTS && function something() {}.name === "something";
        var CONFIGURABLE = EXISTS && (!DESCRIPTORS || DESCRIPTORS && getDescriptor(FunctionPrototype, "name").configurable);
        module.exports = {
            EXISTS: EXISTS,
            PROPER: PROPER,
            CONFIGURABLE: CONFIGURABLE
        };
    },
    9504(module, __unused_webpack_exports, __webpack_require__) {
        var NATIVE_BIND = __webpack_require__(616);
        var FunctionPrototype = Function.prototype;
        var call = FunctionPrototype.call;
        var uncurryThisWithBind = NATIVE_BIND && FunctionPrototype.bind.bind(call, call);
        module.exports = NATIVE_BIND ? uncurryThisWithBind : function(fn) {
            return function() {
                return call.apply(fn, arguments);
            };
        };
    },
    7751(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var isCallable = __webpack_require__(4901);
        var aFunction = function(argument) {
            return isCallable(argument) ? argument : undefined;
        };
        module.exports = function(namespace, method) {
            return arguments.length < 2 ? aFunction(globalThis[namespace]) : globalThis[namespace] && globalThis[namespace][method];
        };
    },
    5966(module, __unused_webpack_exports, __webpack_require__) {
        var aCallable = __webpack_require__(9306);
        var isNullOrUndefined = __webpack_require__(4117);
        module.exports = function(V, P) {
            var func = V[P];
            return isNullOrUndefined(func) ? undefined : aCallable(func);
        };
    },
    4576(module) {
        var check = function(it) {
            return it && it.Math === Math && it;
        };
        module.exports = check(typeof globalThis == "object" && globalThis) || check(typeof window == "object" && window) || check(typeof self == "object" && self) || check(typeof global == "object" && global) || check(typeof this == "object" && this) || function() {
            return this;
        }() || Function("return this")();
    },
    9297(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var toObject = __webpack_require__(8981);
        var hasOwnProperty = uncurryThis({}.hasOwnProperty);
        module.exports = Object.hasOwn || function hasOwn(it, key) {
            return hasOwnProperty(toObject(it), key);
        };
    },
    421(module) {
        module.exports = {};
    },
    5917(module, __unused_webpack_exports, __webpack_require__) {
        var DESCRIPTORS = __webpack_require__(3724);
        var fails = __webpack_require__(9039);
        var createElement = __webpack_require__(4055);
        module.exports = !DESCRIPTORS && !fails(function() {
            return Object.defineProperty(createElement("div"), "a", {
                get: function() {
                    return 7;
                }
            }).a !== 7;
        });
    },
    7055(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var fails = __webpack_require__(9039);
        var classof = __webpack_require__(2195);
        var $Object = Object;
        var split = uncurryThis("".split);
        module.exports = fails(function() {
            return !$Object("z").propertyIsEnumerable(0);
        }) ? function(it) {
            return classof(it) === "String" ? split(it, "") : $Object(it);
        } : $Object;
    },
    3706(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var isCallable = __webpack_require__(4901);
        var store = __webpack_require__(7629);
        var functionToString = uncurryThis(Function.toString);
        if (!isCallable(store.inspectSource)) {
            store.inspectSource = function(it) {
                return functionToString(it);
            };
        }
        module.exports = store.inspectSource;
    },
    1181(module, __unused_webpack_exports, __webpack_require__) {
        var NATIVE_WEAK_MAP = __webpack_require__(8622);
        var globalThis = __webpack_require__(4576);
        var isObject = __webpack_require__(34);
        var createNonEnumerableProperty = __webpack_require__(6699);
        var hasOwn = __webpack_require__(9297);
        var shared = __webpack_require__(7629);
        var sharedKey = __webpack_require__(6119);
        var hiddenKeys = __webpack_require__(421);
        var OBJECT_ALREADY_INITIALIZED = "Object already initialized";
        var TypeError = globalThis.TypeError;
        var WeakMap = globalThis.WeakMap;
        var set, get, has;
        var enforce = function(it) {
            return has(it) ? get(it) : set(it, {});
        };
        var getterFor = function(TYPE) {
            return function(it) {
                var state;
                if (!isObject(it) || (state = get(it)).type !== TYPE) {
                    throw new TypeError("Incompatible receiver, " + TYPE + " required");
                }
                return state;
            };
        };
        if (NATIVE_WEAK_MAP || shared.state) {
            var store = shared.state || (shared.state = new WeakMap);
            store.get = store.get;
            store.has = store.has;
            store.set = store.set;
            set = function(it, metadata) {
                if (store.has(it)) throw new TypeError(OBJECT_ALREADY_INITIALIZED);
                metadata.facade = it;
                store.set(it, metadata);
                return metadata;
            };
            get = function(it) {
                return store.get(it) || {};
            };
            has = function(it) {
                return store.has(it);
            };
        } else {
            var STATE = sharedKey("state");
            hiddenKeys[STATE] = true;
            set = function(it, metadata) {
                if (hasOwn(it, STATE)) throw new TypeError(OBJECT_ALREADY_INITIALIZED);
                metadata.facade = it;
                createNonEnumerableProperty(it, STATE, metadata);
                return metadata;
            };
            get = function(it) {
                return hasOwn(it, STATE) ? it[STATE] : {};
            };
            has = function(it) {
                return hasOwn(it, STATE);
            };
        }
        module.exports = {
            set: set,
            get: get,
            has: has,
            enforce: enforce,
            getterFor: getterFor
        };
    },
    4376(module, __unused_webpack_exports, __webpack_require__) {
        var classof = __webpack_require__(2195);
        module.exports = Array.isArray || function isArray(argument) {
            return classof(argument) === "Array";
        };
    },
    4901(module) {
        var documentAll = typeof document == "object" && document.all;
        module.exports = typeof documentAll == "undefined" && documentAll !== undefined ? function(argument) {
            return typeof argument == "function" || argument === documentAll;
        } : function(argument) {
            return typeof argument == "function";
        };
    },
    2796(module, __unused_webpack_exports, __webpack_require__) {
        var fails = __webpack_require__(9039);
        var isCallable = __webpack_require__(4901);
        var replacement = /#|\.prototype\./;
        var isForced = function(feature, detection) {
            var value = data[normalize(feature)];
            return value === POLYFILL ? true : value === NATIVE ? false : isCallable(detection) ? fails(detection) : !!detection;
        };
        var normalize = isForced.normalize = function(string) {
            return String(string).replace(replacement, ".").toLowerCase();
        };
        var data = isForced.data = {};
        var NATIVE = isForced.NATIVE = "N";
        var POLYFILL = isForced.POLYFILL = "P";
        module.exports = isForced;
    },
    4117(module) {
        module.exports = function(it) {
            return it === null || it === undefined;
        };
    },
    34(module, __unused_webpack_exports, __webpack_require__) {
        var isCallable = __webpack_require__(4901);
        module.exports = function(it) {
            return typeof it == "object" ? it !== null : isCallable(it);
        };
    },
    6395(module) {
        module.exports = false;
    },
    5810(module, __unused_webpack_exports, __webpack_require__) {
        var isObject = __webpack_require__(34);
        var getInternalState = __webpack_require__(1181).get;
        module.exports = function isRawJSON(O) {
            if (!isObject(O)) return false;
            var state = getInternalState(O);
            return !!state && state.type === "RawJSON";
        };
    },
    757(module, __unused_webpack_exports, __webpack_require__) {
        var getBuiltIn = __webpack_require__(7751);
        var isCallable = __webpack_require__(4901);
        var isPrototypeOf = __webpack_require__(1625);
        var USE_SYMBOL_AS_UID = __webpack_require__(7040);
        var $Object = Object;
        module.exports = USE_SYMBOL_AS_UID ? function(it) {
            return typeof it == "symbol";
        } : function(it) {
            var $Symbol = getBuiltIn("Symbol");
            return isCallable($Symbol) && isPrototypeOf($Symbol.prototype, $Object(it));
        };
    },
    6198(module, __unused_webpack_exports, __webpack_require__) {
        var toLength = __webpack_require__(8014);
        module.exports = function(obj) {
            return toLength(obj.length);
        };
    },
    283(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var fails = __webpack_require__(9039);
        var isCallable = __webpack_require__(4901);
        var hasOwn = __webpack_require__(9297);
        var DESCRIPTORS = __webpack_require__(3724);
        var CONFIGURABLE_FUNCTION_NAME = __webpack_require__(350).CONFIGURABLE;
        var inspectSource = __webpack_require__(3706);
        var InternalStateModule = __webpack_require__(1181);
        var enforceInternalState = InternalStateModule.enforce;
        var getInternalState = InternalStateModule.get;
        var $String = String;
        var defineProperty = Object.defineProperty;
        var stringSlice = uncurryThis("".slice);
        var replace = uncurryThis("".replace);
        var join = uncurryThis([].join);
        var CONFIGURABLE_LENGTH = DESCRIPTORS && !fails(function() {
            return defineProperty(function() {}, "length", {
                value: 8
            }).length !== 8;
        });
        var TEMPLATE = String(String).split("String");
        var makeBuiltIn = module.exports = function(value, name, options) {
            if (stringSlice($String(name), 0, 7) === "Symbol(") {
                name = "[" + replace($String(name), /^Symbol\(([^)]*)\).*$/, "$1") + "]";
            }
            if (options && options.getter) name = "get " + name;
            if (options && options.setter) name = "set " + name;
            if (!hasOwn(value, "name") || CONFIGURABLE_FUNCTION_NAME && value.name !== name) {
                if (DESCRIPTORS) defineProperty(value, "name", {
                    value: name,
                    configurable: true
                }); else value.name = name;
            }
            if (CONFIGURABLE_LENGTH && options && hasOwn(options, "arity") && value.length !== options.arity) {
                defineProperty(value, "length", {
                    value: options.arity
                });
            }
            try {
                if (options && hasOwn(options, "constructor") && options.constructor) {
                    if (DESCRIPTORS) defineProperty(value, "prototype", {
                        writable: false
                    });
                } else if (value.prototype) value.prototype = undefined;
            } catch (error) {}
            var state = enforceInternalState(value);
            if (!hasOwn(state, "source")) {
                state.source = join(TEMPLATE, typeof name == "string" ? name : "");
            }
            return value;
        };
        Function.prototype.toString = makeBuiltIn(function toString() {
            return isCallable(this) && getInternalState(this).source || inspectSource(this);
        }, "toString");
    },
    2248(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var MapPrototype = Map.prototype;
        module.exports = {
            Map: Map,
            set: uncurryThis(MapPrototype.set),
            get: uncurryThis(MapPrototype.get),
            has: uncurryThis(MapPrototype.has),
            remove: uncurryThis(MapPrototype["delete"]),
            proto: MapPrototype
        };
    },
    741(module) {
        var ceil = Math.ceil;
        var floor = Math.floor;
        module.exports = Math.trunc || function trunc(x) {
            var n = +x;
            return (n > 0 ? floor : ceil)(n);
        };
    },
    7819(module, __unused_webpack_exports, __webpack_require__) {
        var fails = __webpack_require__(9039);
        module.exports = !fails(function() {
            var unsafeInt = "9007199254740993";
            var raw = JSON.rawJSON(unsafeInt);
            return !JSON.isRawJSON(raw) || JSON.stringify(raw) !== unsafeInt;
        });
    },
    4913(__unused_webpack_module, exports, __webpack_require__) {
        var DESCRIPTORS = __webpack_require__(3724);
        var IE8_DOM_DEFINE = __webpack_require__(5917);
        var V8_PROTOTYPE_DEFINE_BUG = __webpack_require__(8686);
        var anObject = __webpack_require__(8551);
        var toPropertyKey = __webpack_require__(6969);
        var $TypeError = TypeError;
        var $defineProperty = Object.defineProperty;
        var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        var ENUMERABLE = "enumerable";
        var CONFIGURABLE = "configurable";
        var WRITABLE = "writable";
        exports.f = DESCRIPTORS ? V8_PROTOTYPE_DEFINE_BUG ? function defineProperty(O, P, Attributes) {
            anObject(O);
            P = toPropertyKey(P);
            anObject(Attributes);
            if (typeof O === "function" && P === "prototype" && "value" in Attributes && WRITABLE in Attributes && !Attributes[WRITABLE]) {
                var current = $getOwnPropertyDescriptor(O, P);
                if (current && current[WRITABLE]) {
                    O[P] = Attributes.value;
                    Attributes = {
                        configurable: CONFIGURABLE in Attributes ? Attributes[CONFIGURABLE] : current[CONFIGURABLE],
                        enumerable: ENUMERABLE in Attributes ? Attributes[ENUMERABLE] : current[ENUMERABLE],
                        writable: false
                    };
                }
            }
            return $defineProperty(O, P, Attributes);
        } : $defineProperty : function defineProperty(O, P, Attributes) {
            anObject(O);
            P = toPropertyKey(P);
            anObject(Attributes);
            if (IE8_DOM_DEFINE) try {
                return $defineProperty(O, P, Attributes);
            } catch (error) {}
            if ("get" in Attributes || "set" in Attributes) throw new $TypeError("Accessors not supported");
            if ("value" in Attributes) O[P] = Attributes.value;
            return O;
        };
    },
    7347(__unused_webpack_module, exports, __webpack_require__) {
        var DESCRIPTORS = __webpack_require__(3724);
        var call = __webpack_require__(9565);
        var propertyIsEnumerableModule = __webpack_require__(8773);
        var createPropertyDescriptor = __webpack_require__(6980);
        var toIndexedObject = __webpack_require__(5397);
        var toPropertyKey = __webpack_require__(6969);
        var hasOwn = __webpack_require__(9297);
        var IE8_DOM_DEFINE = __webpack_require__(5917);
        var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        exports.f = DESCRIPTORS ? $getOwnPropertyDescriptor : function getOwnPropertyDescriptor(O, P) {
            O = toIndexedObject(O);
            P = toPropertyKey(P);
            if (IE8_DOM_DEFINE) try {
                return $getOwnPropertyDescriptor(O, P);
            } catch (error) {}
            if (hasOwn(O, P)) return createPropertyDescriptor(!call(propertyIsEnumerableModule.f, O, P), O[P]);
        };
    },
    8480(__unused_webpack_module, exports, __webpack_require__) {
        var internalObjectKeys = __webpack_require__(1828);
        var enumBugKeys = __webpack_require__(8727);
        var hiddenKeys = enumBugKeys.concat("length", "prototype");
        exports.f = Object.getOwnPropertyNames || function getOwnPropertyNames(O) {
            return internalObjectKeys(O, hiddenKeys);
        };
    },
    3717(__unused_webpack_module, exports) {
        exports.f = Object.getOwnPropertySymbols;
    },
    1625(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        module.exports = uncurryThis({}.isPrototypeOf);
    },
    1828(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var hasOwn = __webpack_require__(9297);
        var toIndexedObject = __webpack_require__(5397);
        var indexOf = __webpack_require__(9617).indexOf;
        var hiddenKeys = __webpack_require__(421);
        var push = uncurryThis([].push);
        module.exports = function(object, names) {
            var O = toIndexedObject(object);
            var i = 0;
            var result = [];
            var key;
            for (key in O) !hasOwn(hiddenKeys, key) && hasOwn(O, key) && push(result, key);
            while (names.length > i) if (hasOwn(O, key = names[i++])) {
                ~indexOf(result, key) || push(result, key);
            }
            return result;
        };
    },
    8773(__unused_webpack_module, exports) {
        var $propertyIsEnumerable = {}.propertyIsEnumerable;
        var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
        var NASHORN_BUG = getOwnPropertyDescriptor && !$propertyIsEnumerable.call({
            1: 2
        }, 1);
        exports.f = NASHORN_BUG ? function propertyIsEnumerable(V) {
            var descriptor = getOwnPropertyDescriptor(this, V);
            return !!descriptor && descriptor.enumerable;
        } : $propertyIsEnumerable;
    },
    4270(module, __unused_webpack_exports, __webpack_require__) {
        var call = __webpack_require__(9565);
        var isCallable = __webpack_require__(4901);
        var isObject = __webpack_require__(34);
        var $TypeError = TypeError;
        module.exports = function(input, pref) {
            var fn, val;
            if (pref === "string" && isCallable(fn = input.toString) && !isObject(val = call(fn, input))) return val;
            if (isCallable(fn = input.valueOf) && !isObject(val = call(fn, input))) return val;
            if (pref !== "string" && isCallable(fn = input.toString) && !isObject(val = call(fn, input))) return val;
            throw new $TypeError("Can't convert object to primitive value");
        };
    },
    5031(module, __unused_webpack_exports, __webpack_require__) {
        var getBuiltIn = __webpack_require__(7751);
        var uncurryThis = __webpack_require__(9504);
        var getOwnPropertyNamesModule = __webpack_require__(8480);
        var getOwnPropertySymbolsModule = __webpack_require__(3717);
        var anObject = __webpack_require__(8551);
        var concat = uncurryThis([].concat);
        module.exports = getBuiltIn("Reflect", "ownKeys") || function ownKeys(it) {
            var keys = getOwnPropertyNamesModule.f(anObject(it));
            var getOwnPropertySymbols = getOwnPropertySymbolsModule.f;
            return getOwnPropertySymbols ? concat(keys, getOwnPropertySymbols(it)) : keys;
        };
    },
    8235(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var hasOwn = __webpack_require__(9297);
        var $SyntaxError = SyntaxError;
        var $parseInt = parseInt;
        var fromCharCode = String.fromCharCode;
        var at = uncurryThis("".charAt);
        var slice = uncurryThis("".slice);
        var exec = uncurryThis(/./.exec);
        var codePoints = {
            '\\"': '"',
            "\\\\": "\\",
            "\\/": "/",
            "\\b": "\b",
            "\\f": "\f",
            "\\n": "\n",
            "\\r": "\r",
            "\\t": "\t"
        };
        var IS_4_HEX_DIGITS = /^[\da-f]{4}$/i;
        var IS_C0_CONTROL_CODE = /^[\u0000-\u001F]$/;
        module.exports = function(source, i) {
            var unterminated = true;
            var value = "";
            while (i < source.length) {
                var chr = at(source, i);
                if (chr === "\\") {
                    var twoChars = slice(source, i, i + 2);
                    if (hasOwn(codePoints, twoChars)) {
                        value += codePoints[twoChars];
                        i += 2;
                    } else if (twoChars === "\\u") {
                        i += 2;
                        var fourHexDigits = slice(source, i, i + 4);
                        if (!exec(IS_4_HEX_DIGITS, fourHexDigits)) throw new $SyntaxError("Bad Unicode escape at: " + i);
                        value += fromCharCode($parseInt(fourHexDigits, 16));
                        i += 4;
                    } else throw new $SyntaxError('Unknown escape sequence: "' + twoChars + '"');
                } else if (chr === '"') {
                    unterminated = false;
                    i++;
                    break;
                } else {
                    if (exec(IS_C0_CONTROL_CODE, chr)) throw new $SyntaxError("Bad control character in string literal at: " + i);
                    value += chr;
                    i++;
                }
            }
            if (unterminated) throw new $SyntaxError("Unterminated string at: " + i);
            return {
                value: value,
                end: i
            };
        };
    },
    7750(module, __unused_webpack_exports, __webpack_require__) {
        var isNullOrUndefined = __webpack_require__(4117);
        var $TypeError = TypeError;
        module.exports = function(it) {
            if (isNullOrUndefined(it)) throw new $TypeError("Can't call method on " + it);
            return it;
        };
    },
    6119(module, __unused_webpack_exports, __webpack_require__) {
        var shared = __webpack_require__(5745);
        var uid = __webpack_require__(3392);
        var keys = shared("keys");
        module.exports = function(key) {
            return keys[key] || (keys[key] = uid(key));
        };
    },
    7629(module, __unused_webpack_exports, __webpack_require__) {
        var IS_PURE = __webpack_require__(6395);
        var globalThis = __webpack_require__(4576);
        var defineGlobalProperty = __webpack_require__(9433);
        var SHARED = "__core-js_shared__";
        var store = module.exports = globalThis[SHARED] || defineGlobalProperty(SHARED, {});
        (store.versions || (store.versions = [])).push({
            version: "3.49.0",
            mode: IS_PURE ? "pure" : "global",
            copyright: "© 2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io). All rights reserved.",
            license: "https://github.com/zloirock/core-js/blob/v3.49.0/LICENSE",
            source: "https://github.com/zloirock/core-js"
        });
    },
    5745(module, __unused_webpack_exports, __webpack_require__) {
        var store = __webpack_require__(7629);
        module.exports = function(key, value) {
            return store[key] || (store[key] = value || {});
        };
    },
    4495(module, __unused_webpack_exports, __webpack_require__) {
        var V8_VERSION = __webpack_require__(9519);
        var fails = __webpack_require__(9039);
        var globalThis = __webpack_require__(4576);
        var $String = globalThis.String;
        module.exports = !!Object.getOwnPropertySymbols && !fails(function() {
            var symbol = Symbol("symbol detection");
            return !$String(symbol) || !(Object(symbol) instanceof Symbol) || !Symbol.sham && V8_VERSION && V8_VERSION < 41;
        });
    },
    5610(module, __unused_webpack_exports, __webpack_require__) {
        var toIntegerOrInfinity = __webpack_require__(1291);
        var max = Math.max;
        var min = Math.min;
        module.exports = function(index, length) {
            var integer = toIntegerOrInfinity(index);
            return integer < 0 ? max(integer + length, 0) : min(integer, length);
        };
    },
    5397(module, __unused_webpack_exports, __webpack_require__) {
        var IndexedObject = __webpack_require__(7055);
        var requireObjectCoercible = __webpack_require__(7750);
        module.exports = function(it) {
            return IndexedObject(requireObjectCoercible(it));
        };
    },
    1291(module, __unused_webpack_exports, __webpack_require__) {
        var trunc = __webpack_require__(741);
        module.exports = function(argument) {
            var number = +argument;
            return number !== number || number === 0 ? 0 : trunc(number);
        };
    },
    8014(module, __unused_webpack_exports, __webpack_require__) {
        var toIntegerOrInfinity = __webpack_require__(1291);
        var min = Math.min;
        module.exports = function(argument) {
            var len = toIntegerOrInfinity(argument);
            return len > 0 ? min(len, 9007199254740991) : 0;
        };
    },
    8981(module, __unused_webpack_exports, __webpack_require__) {
        var requireObjectCoercible = __webpack_require__(7750);
        var $Object = Object;
        module.exports = function(argument) {
            return $Object(requireObjectCoercible(argument));
        };
    },
    2777(module, __unused_webpack_exports, __webpack_require__) {
        var call = __webpack_require__(9565);
        var isObject = __webpack_require__(34);
        var isSymbol = __webpack_require__(757);
        var getMethod = __webpack_require__(5966);
        var ordinaryToPrimitive = __webpack_require__(4270);
        var wellKnownSymbol = __webpack_require__(8227);
        var $TypeError = TypeError;
        var TO_PRIMITIVE = wellKnownSymbol("toPrimitive");
        module.exports = function(input, pref) {
            if (!isObject(input) || isSymbol(input)) return input;
            var exoticToPrim = getMethod(input, TO_PRIMITIVE);
            var result;
            if (exoticToPrim) {
                if (pref === undefined) pref = "default";
                result = call(exoticToPrim, input, pref);
                if (!isObject(result) || isSymbol(result)) return result;
                throw new $TypeError("Can't convert object to primitive value");
            }
            if (pref === undefined) pref = "number";
            return ordinaryToPrimitive(input, pref);
        };
    },
    6969(module, __unused_webpack_exports, __webpack_require__) {
        var toPrimitive = __webpack_require__(2777);
        var isSymbol = __webpack_require__(757);
        module.exports = function(argument) {
            var key = toPrimitive(argument, "string");
            return isSymbol(key) ? key : key + "";
        };
    },
    2140(module, __unused_webpack_exports, __webpack_require__) {
        var wellKnownSymbol = __webpack_require__(8227);
        var TO_STRING_TAG = wellKnownSymbol("toStringTag");
        var test = {};
        test[TO_STRING_TAG] = "z";
        module.exports = String(test) === "[object z]";
    },
    655(module, __unused_webpack_exports, __webpack_require__) {
        var classof = __webpack_require__(6955);
        var $String = String;
        module.exports = function(argument) {
            if (classof(argument) === "Symbol") throw new TypeError("Cannot convert a Symbol value to a string");
            return $String(argument);
        };
    },
    6823(module) {
        var $String = String;
        module.exports = function(argument) {
            try {
                return $String(argument);
            } catch (error) {
                return "Object";
            }
        };
    },
    3392(module, __unused_webpack_exports, __webpack_require__) {
        var uncurryThis = __webpack_require__(9504);
        var id = 0;
        var postfix = Math.random();
        var toString = uncurryThis(1.1.toString);
        module.exports = function(key) {
            return "Symbol(" + (key === undefined ? "" : key) + ")_" + toString(++id + postfix, 36);
        };
    },
    7040(module, __unused_webpack_exports, __webpack_require__) {
        var NATIVE_SYMBOL = __webpack_require__(4495);
        module.exports = NATIVE_SYMBOL && !Symbol.sham && typeof Symbol.iterator == "symbol";
    },
    8686(module, __unused_webpack_exports, __webpack_require__) {
        var DESCRIPTORS = __webpack_require__(3724);
        var fails = __webpack_require__(9039);
        module.exports = DESCRIPTORS && fails(function() {
            return Object.defineProperty(function() {}, "prototype", {
                value: 42,
                writable: false
            }).prototype !== 42;
        });
    },
    8622(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var isCallable = __webpack_require__(4901);
        var WeakMap = globalThis.WeakMap;
        module.exports = isCallable(WeakMap) && /native code/.test(String(WeakMap));
    },
    8227(module, __unused_webpack_exports, __webpack_require__) {
        var globalThis = __webpack_require__(4576);
        var shared = __webpack_require__(5745);
        var hasOwn = __webpack_require__(9297);
        var uid = __webpack_require__(3392);
        var NATIVE_SYMBOL = __webpack_require__(4495);
        var USE_SYMBOL_AS_UID = __webpack_require__(7040);
        var Symbol = globalThis.Symbol;
        var WellKnownSymbolsStore = shared("wks");
        var createWellKnownSymbol = USE_SYMBOL_AS_UID ? Symbol["for"] || Symbol : Symbol && Symbol.withoutSetter || uid;
        module.exports = function(name) {
            if (!hasOwn(WellKnownSymbolsStore, name)) {
                WellKnownSymbolsStore[name] = NATIVE_SYMBOL && hasOwn(Symbol, name) ? Symbol[name] : createWellKnownSymbol("Symbol." + name);
            }
            return WellKnownSymbolsStore[name];
        };
    },
    4114(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {
        var $ = __webpack_require__(6518);
        var toObject = __webpack_require__(8981);
        var lengthOfArrayLike = __webpack_require__(6198);
        var setArrayLength = __webpack_require__(4527);
        var doesNotExceedSafeInteger = __webpack_require__(6837);
        var fails = __webpack_require__(9039);
        var INCORRECT_TO_LENGTH = fails(function() {
            return [].push.call({
                length: 4294967296
            }, 1) !== 4294967297;
        });
        var properErrorOnNonWritableLength = function() {
            try {
                Object.defineProperty([], "length", {
                    writable: false
                }).push();
            } catch (error) {
                return error instanceof TypeError;
            }
        };
        var FORCED = INCORRECT_TO_LENGTH || !properErrorOnNonWritableLength();
        $({
            target: "Array",
            proto: true,
            arity: 1,
            forced: FORCED
        }, {
            push: function push(item) {
                var O = toObject(this);
                var len = lengthOfArrayLike(O);
                var argCount = arguments.length;
                doesNotExceedSafeInteger(len + argCount);
                for (var i = 0; i < argCount; i++) {
                    O[len] = arguments[i];
                    len++;
                }
                setArrayLength(O, len);
                return len;
            }
        });
    },
    3110(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {
        var $ = __webpack_require__(6518);
        var getBuiltIn = __webpack_require__(7751);
        var apply = __webpack_require__(8745);
        var call = __webpack_require__(9565);
        var uncurryThis = __webpack_require__(9504);
        var fails = __webpack_require__(9039);
        var isArray = __webpack_require__(4376);
        var isCallable = __webpack_require__(4901);
        var isRawJSON = __webpack_require__(5810);
        var isSymbol = __webpack_require__(757);
        var classof = __webpack_require__(2195);
        var toString = __webpack_require__(655);
        var arraySlice = __webpack_require__(7680);
        var parseJSONString = __webpack_require__(8235);
        var uid = __webpack_require__(3392);
        var NATIVE_SYMBOL = __webpack_require__(4495);
        var NATIVE_RAW_JSON = __webpack_require__(7819);
        var $String = String;
        var $stringify = getBuiltIn("JSON", "stringify");
        var exec = uncurryThis(/./.exec);
        var charAt = uncurryThis("".charAt);
        var charCodeAt = uncurryThis("".charCodeAt);
        var replace = uncurryThis("".replace);
        var slice = uncurryThis("".slice);
        var push = uncurryThis([].push);
        var numberToString = uncurryThis(1.1.toString);
        var surrogates = /[\uD800-\uDFFF]/g;
        var leadingSurrogates = /^[\uD800-\uDBFF]$/;
        var trailingSurrogates = /^[\uDC00-\uDFFF]$/;
        var MARK = uid();
        var MARK_LENGTH = MARK.length;
        var WRONG_SYMBOLS_CONVERSION = !NATIVE_SYMBOL || fails(function() {
            var symbol = getBuiltIn("Symbol")("stringify detection");
            return $stringify([ symbol ]) !== "[null]" || $stringify({
                a: symbol
            }) !== "{}" || $stringify(Object(symbol)) !== "{}";
        });
        var ILL_FORMED_UNICODE = fails(function() {
            return $stringify("\udf06\ud834") !== '"\\udf06\\ud834"' || $stringify("\udead") !== '"\\udead"';
        });
        var stringifyWithProperSymbolsConversion = WRONG_SYMBOLS_CONVERSION ? function(it, replacer) {
            var args = arraySlice(arguments);
            var $replacer = getReplacerFunction(replacer);
            if (!isCallable($replacer) && (it === undefined || isSymbol(it))) return;
            args[1] = function(key, value) {
                if (isCallable($replacer)) value = call($replacer, this, $String(key), value);
                if (!isSymbol(value)) return value;
            };
            return apply($stringify, null, args);
        } : $stringify;
        var fixIllFormedJSON = function(match, offset, string) {
            var prev = charAt(string, offset - 1);
            var next = charAt(string, offset + 1);
            if (exec(leadingSurrogates, match) && !exec(trailingSurrogates, next) || exec(trailingSurrogates, match) && !exec(leadingSurrogates, prev)) {
                return "\\u" + numberToString(charCodeAt(match, 0), 16);
            }
            return match;
        };
        var getReplacerFunction = function(replacer) {
            if (isCallable(replacer)) return replacer;
            if (!isArray(replacer)) return;
            var rawLength = replacer.length;
            var keys = [];
            for (var i = 0; i < rawLength; i++) {
                var element = replacer[i];
                if (typeof element == "string") push(keys, element); else if (typeof element == "number" || classof(element) === "Number" || classof(element) === "String") push(keys, toString(element));
            }
            var keysLength = keys.length;
            var root = true;
            return function(key, value) {
                if (root) {
                    root = false;
                    return value;
                }
                if (isArray(this)) return value;
                for (var j = 0; j < keysLength; j++) if (keys[j] === key) return value;
            };
        };
        if ($stringify) $({
            target: "JSON",
            stat: true,
            arity: 3,
            forced: WRONG_SYMBOLS_CONVERSION || ILL_FORMED_UNICODE || !NATIVE_RAW_JSON
        }, {
            stringify: function stringify(text, replacer, space) {
                var replacerFunction = getReplacerFunction(replacer);
                var rawStrings = [];
                var json = stringifyWithProperSymbolsConversion(text, function(key, value) {
                    var v = isCallable(replacerFunction) ? call(replacerFunction, this, $String(key), value) : value;
                    return !NATIVE_RAW_JSON && isRawJSON(v) ? MARK + (push(rawStrings, v.rawJSON) - 1) : v;
                }, space);
                if (typeof json != "string") return json;
                if (ILL_FORMED_UNICODE) json = replace(json, surrogates, fixIllFormedJSON);
                if (NATIVE_RAW_JSON) return json;
                var result = "";
                var length = json.length;
                for (var i = 0; i < length; i++) {
                    var chr = charAt(json, i);
                    if (chr === '"') {
                        var end = parseJSONString(json, ++i).end - 1;
                        var string = slice(json, i, end);
                        result += slice(string, 0, MARK_LENGTH) === MARK ? rawStrings[slice(string, MARK_LENGTH)] : '"' + string + '"';
                        i = end;
                    } else result += chr;
                }
                return result;
            }
        });
    },
    2731(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {
        var $ = __webpack_require__(6518);
        var aCallable = __webpack_require__(9306);
        var MapHelpers = __webpack_require__(2248);
        var IS_PURE = __webpack_require__(6395);
        var get = MapHelpers.get;
        var has = MapHelpers.has;
        var set = MapHelpers.set;
        $({
            target: "Map",
            proto: true,
            real: true,
            forced: IS_PURE
        }, {
            getOrInsertComputed: function getOrInsertComputed(key, callbackfn) {
                var hasKey = has(this, key);
                aCallable(callbackfn);
                if (hasKey) return get(this, key);
                if (key === 0 && 1 / key === -Infinity) key = 0;
                var value = callbackfn(key);
                set(this, key, value);
                return value;
            }
        });
    },
    5367(__unused_webpack_module, __unused_webpack_exports, __webpack_require__) {
        var $ = __webpack_require__(6518);
        var MapHelpers = __webpack_require__(2248);
        var IS_PURE = __webpack_require__(6395);
        var get = MapHelpers.get;
        var has = MapHelpers.has;
        var set = MapHelpers.set;
        $({
            target: "Map",
            proto: true,
            real: true,
            forced: IS_PURE
        }, {
            getOrInsert: function getOrInsert(key, value) {
                if (has(this, key)) return get(this, key);
                set(this, key, value);
                return value;
            }
        });
    }
};

var __webpack_module_cache__ = {};

function __webpack_require__(moduleId) {
    var cachedModule = __webpack_module_cache__[moduleId];
    if (cachedModule !== undefined) {
        return cachedModule.exports;
    }
    var module = __webpack_module_cache__[moduleId] = {
        exports: {}
    };
    __webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
    return module.exports;
}

(() => {
    __webpack_require__.d = (exports, definition) => {
        for (var key in definition) {
            if (__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
                Object.defineProperty(exports, key, {
                    enumerable: true,
                    get: definition[key]
                });
            }
        }
    };
})();

(() => {
    __webpack_require__.o = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
})();

var es_array_push = __webpack_require__(4114);

var es_json_stringify = __webpack_require__(3110);

var es_map_get_or_insert = __webpack_require__(5367);

var es_map_get_or_insert_computed = __webpack_require__(2731);

class SandboxSupportBase {
    constructor(win) {
        this.win = win;
        this.timeoutIds = new Map;
        this.commFun = null;
    }
    destroy() {
        this.commFun = null;
        for (const id of this.timeoutIds.values()) {
            this.win.clearTimeout(id);
        }
        this.timeoutIds = null;
    }
    exportValueToSandbox(val) {
        throw new Error("Not implemented");
    }
    importValueFromSandbox(val) {
        throw new Error("Not implemented");
    }
    createErrorForSandbox(errorMessage) {
        throw new Error("Not implemented");
    }
    callSandboxFunction(name, args) {
        if (!this.commFun) {
            return;
        }
        try {
            args = this.exportValueToSandbox(args);
            this.commFun(name, args);
        } catch (e) {
            this.win.console.error(e);
        }
    }
    createSandboxExternals() {
        const externals = {
            setTimeout: (callbackId, nMilliseconds) => {
                if (typeof callbackId !== "number" || typeof nMilliseconds !== "number") {
                    return;
                }
                if (callbackId === 0) {
                    this.win.clearTimeout(this.timeoutIds.get(callbackId));
                }
                const id = this.win.setTimeout(() => {
                    this.timeoutIds.delete(callbackId);
                    this.callSandboxFunction("timeoutCb", {
                        callbackId: callbackId,
                        interval: false
                    });
                }, nMilliseconds);
                this.timeoutIds.set(callbackId, id);
            },
            clearTimeout: callbackId => {
                this.win.clearTimeout(this.timeoutIds.get(callbackId));
                this.timeoutIds.delete(callbackId);
            },
            setInterval: (callbackId, nMilliseconds) => {
                if (typeof callbackId !== "number" || typeof nMilliseconds !== "number") {
                    return;
                }
                const id = this.win.setInterval(() => {
                    this.callSandboxFunction("timeoutCb", {
                        callbackId: callbackId,
                        interval: true
                    });
                }, nMilliseconds);
                this.timeoutIds.set(callbackId, id);
            },
            clearInterval: callbackId => {
                this.win.clearInterval(this.timeoutIds.get(callbackId));
                this.timeoutIds.delete(callbackId);
            },
            alert: cMsg => {
                if (typeof cMsg !== "string") {
                    return;
                }
                this.win.alert(cMsg);
            },
            confirm: cMsg => {
                if (typeof cMsg !== "string") {
                    return false;
                }
                return this.win.confirm(cMsg);
            },
            prompt: (cQuestion, cDefault) => {
                if (typeof cQuestion !== "string" || typeof cDefault !== "string") {
                    return null;
                }
                return this.win.prompt(cQuestion, cDefault);
            },
            parseURL: cUrl => {
                const url = new this.win.URL(cUrl);
                const props = [ "hash", "host", "hostname", "href", "origin", "password", "pathname", "port", "protocol", "search", "searchParams", "username" ];
                return Object.fromEntries(props.map(name => [ name, url[name].toString() ]));
            },
            send: data => {
                if (!data) {
                    return;
                }
                const event = new this.win.CustomEvent("updatefromsandbox", {
                    detail: this.importValueFromSandbox(data)
                });
                this.win.dispatchEvent(event);
            }
        };
        Object.setPrototypeOf(externals, null);
        return (name, args) => {
            try {
                const result = externals[name](...args);
                return this.exportValueToSandbox(result);
            } catch (error) {
                throw this.createErrorForSandbox(error?.toString() ?? "");
            }
        };
    }
}

class SandboxSupport extends SandboxSupportBase {
    exportValueToSandbox(val) {
        return JSON.stringify(val);
    }
    importValueFromSandbox(val) {
        return val;
    }
    createErrorForSandbox(errorMessage) {
        return new Error(errorMessage);
    }
}

class Sandbox {
    constructor(win, module) {
        this.support = new SandboxSupport(win, this);
        module.externalCall = this.support.createSandboxExternals();
        this._module = module;
        this._alertOnError = 0;
    }
    create(data) {
        const code = [ '/******/ var __webpack_modules__ = ({\n\n/***/ 9306\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar isCallable = __webpack_require__(4901);\nvar tryToString = __webpack_require__(6823);\n\nvar $TypeError = TypeError;\n\n// `Assert: IsCallable(argument) is true`\nmodule.exports = function (argument) {\n  if (isCallable(argument)) return argument;\n  throw new $TypeError(tryToString(argument) + \' is not a function\');\n};\n\n\n/***/ },\n\n/***/ 7080\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar has = (__webpack_require__(4402).has);\n\n// Perform ? RequireInternalSlot(M, [[SetData]])\nmodule.exports = function (it) {\n  has(it);\n  return it;\n};\n\n\n/***/ },\n\n/***/ 4328\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar WeakMapHelpers = __webpack_require__(4995);\n\nvar weakmap = new WeakMapHelpers.WeakMap();\nvar set = WeakMapHelpers.set;\nvar remove = WeakMapHelpers.remove;\n\nmodule.exports = function (key) {\n  set(weakmap, key, 1);\n  remove(weakmap, key);\n  return key;\n};\n\n\n/***/ },\n\n/***/ 6557\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar has = (__webpack_require__(4995).has);\n\n// Perform ? RequireInternalSlot(M, [[WeakMapData]])\nmodule.exports = function (it) {\n  has(it);\n  return it;\n};\n\n\n/***/ },\n\n/***/ 6469\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar wellKnownSymbol = __webpack_require__(8227);\nvar create = __webpack_require__(2360);\nvar defineProperty = (__webpack_require__(4913).f);\n\nvar UNSCOPABLES = wellKnownSymbol(\'unscopables\');\nvar ArrayPrototype = Array.prototype;\n\n// Array.prototype[@@unscopables]\n// https://tc39.es/ecma262/#sec-array.prototype-@@unscopables\nif (ArrayPrototype[UNSCOPABLES] === undefined) {\n  defineProperty(ArrayPrototype, UNSCOPABLES, {\n    configurable: true,\n    value: create(null)\n  });\n}\n\n// add a key to Array.prototype[@@unscopables]\nmodule.exports = function (key) {\n  ArrayPrototype[UNSCOPABLES][key] = true;\n};\n\n\n/***/ },\n\n/***/ 679\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar isPrototypeOf = __webpack_require__(1625);\n\nvar $TypeError = TypeError;\n\nmodule.exports = function (it, Prototype) {\n  if (isPrototypeOf(Prototype, it)) return it;\n  throw new $TypeError(\'Incorrect invocation\');\n};\n\n\n/***/ },\n\n/***/ 8551\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar isObject = __webpack_require__(34);\n\nvar $String = String;\nvar $TypeError = TypeError;\n\n// `Assert: Type(argument) is Object`\nmodule.exports = function (argument) {\n  if (isObject(argument)) return argument;\n  throw new $TypeError($String(argument) + \' is not an object\');\n};\n\n\n/***/ },\n\n/***/ 9617\n(module, __unused_webpack_exports, __webpack_require__) {\n\n\nvar toIndexedObject = __webpack_require__(5397);\nvar toAbsoluteIndex = __webpack_require__(5610);\nvar lengthOfArrayLike = __webpack_require__(6198);\n\n// `Array.prototype.{ indexOf, includes }` methods implementation\nvar createMethod = function (IS_INCLUDES) {\n  return function ($this, el, fromIndex) {\n    var O = toIndexedObject($this);\n    var length = lengthOfArrayLike(O);\n    if (length === 0) return !IS_INCLUDES && -1;\n    var index = toAbsoluteIndex(fromIndex, length);\n    var value;\n    // Array#includes uses SameValueZero equality algorithm\n    \': \'\\n\',\n  \'\\\\r\': \'\\r\',\n  \'\\\\t\': \'\\t\'\n};\n\nvar IS_4_HEX_DIGITS = /^[\\da-f]{4}$/i;\n${error.stack}`;\n  return {\n    command: "error",\n    value\n  };\n}\nconst makeArr = () => [];\nconst makeMap = () => new Map();\n\n;// ./src/scripting_api/field.js\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nclass Field extends PDFObject {\n  constructor(data) {\n    super(data);\n    this.alignment = data.alignment || "left";\n    this.borderStyle = data.borderStyle || "";\n    this.buttonAlignX = data.buttonAlignX || 50;\n    this.buttonAlignY = data.buttonAlignY || 50;\n    this.buttonFitBounds = data.buttonFitBounds;\n    this.buttonPosition = data.buttonPosition;\n    this.buttonScaleHow = data.buttonScaleHow;\n    this.ButtonScaleWhen = data.buttonScaleWhen;\n    this.calcOrderIndex = data.calcOrderIndex;\n    this.comb = data.comb;\n    this.commitOnSelChange = data.commitOnSelChange;\n    this.currentValueIndices = data.currentValueIndices;\n    this.defaultStyle = data.defaultStyle;\n    this.defaultValue = data.defaultValue;\n    this.doNotScroll = data.doNotScroll;\n    this.doNotSpellCheck = data.doNotSpellCheck;\n    this.delay = data.delay;\n    this.display = data.display;\n    this.doc = data.doc.wrapped;\n    this.editable = data.editable;\n    this.exportValues = data.exportValues;\n    this.fileSelect = data.fileSelect;\n    this.hidden = data.hidden;\n    this.highlight = data.highlight;\n    this.lineWidth = data.lineWidth;\n    this.multiline = data.multiline;\n    this.multipleSelection = !!data.multipleSelection;\n    this.name = data.name;\n    this.password = data.password;\n    this.print = data.print;\n    this.radiosInUnison = data.radiosInUnison;\n    this.readonly = data.readonly;\n    this.rect = data.rect;\n    this.required = data.required;\n    this.richText = data.richText;\n    this.richValue = data.richValue;\n    this.style = data.style;\n    this.submitName = data.submitName;\n    this.textFont = data.textFont;\n    this.textSize = data.textSize;\n    this.type = data.type;\n    this.userName = data.userName;\n    this._actions = createActionsMap(data.actions);\n    this._browseForFileToSubmit = data.browseForFileToSubmit || null;\n    this._buttonCaption = null;\n    this._buttonIcon = null;\n    this._charLimit = data.charLimit;\n    this._children = null;\n    this._currentValueIndices = data.currentValueIndices || 0;\n    this._document = data.doc;\n    this._fieldPath = data.fieldPath;\n    this._fillColor = data.fillColor || ["T"];\n    this._isChoice = Array.isArray(data.items);\n    this._items = data.items || [];\n    this._hasValue = Object.hasOwn(data, "value");\n    this._page = data.page || 0;\n    this._strokeColor = data.strokeColor || ["G", 0];\n    this._textColor = data.textColor || ["G", 0];\n    this._value = null;\n    this._kidIds = data.kidIds || null;\n    this._fieldType = getFieldType(this._actions);\n    this._siblings = data.siblings || null;\n    this._rotation = data.rotation || 0;\n    this._datetimeFormat = data.datetimeFormat || null;\n    this._hasDateOrTime = !!data.hasDatetimeHTML;\n    this._util = data.util;\n    this._globalEval = data.globalEval;\n    this._appObjects = data.appObjects;\n    this.value = data.value || "";\n  }\n  get currentValueIndices() {\n    if (!this._isChoice) {\n      return 0;\n    }\n    return this._currentValueIndices;\n  }\n  set currentValueIndices(indices) {\n    if (!this._isChoice) {\n      return;\n    }\n    if (!Array.isArray(indices)) {\n      indices = [indices];\n    }\n    if (!indices.every(i => typeof i === "number" && Number.isInteger(i) && i >= 0 && i < this.numItems)) {\n      return;\n    }\n    indices.sort();\n    if (this.multipleSelection) {\n      this._currentValueIndices = indices;\n      this._value = [];\n      indices.forEach(i => {\n        this._value.push(this._items[i].displayValue);\n      });\n    } else if (indices.length > 0) {\n      indices = indices.splice(1, indices.length - 1);\n      this._currentValueIndices = indices[0];\n      this._value = this._items[this._currentValueIndices];\n    }\n    this._send({\n      id: this._id,\n      indices\n    });\n  }\n  get fillColor() {\n    return this._fillColor;\n  }\n  set fillColor(color) {\n    if (Color._isValidColor(color)) {\n      this._fillColor = color;\n    }\n  }\n  get bgColor() {\n    return this.fillColor;\n  }\n  set bgColor(color) {\n    this.fillColor = color;\n  }\n  get charLimit() {\n    return this._charLimit;\n  }\n  set charLimit(limit) {\n    if (typeof limit !== "number") {\n      throw new Error("Invalid argument value");\n    }\n    this._charLimit = Math.max(0, Math.floor(limit));\n  }\n  get numItems() {\n    if (!this._isChoice) {\n      throw new Error("Not a choice widget");\n    }\n    return this._items.length;\n  }\n  set numItems(_) {\n    throw new Error("field.numItems is read-only");\n  }\n  get strokeColor() {\n    return this._strokeColor;\n  }\n  set strokeColor(color) {\n    if (Color._isValidColor(color)) {\n      this._strokeColor = color;\n    }\n  }\n  get borderColor() {\n    return this.strokeColor;\n  }\n  set borderColor(color) {\n    this.strokeColor = color;\n  }\n  get page() {\n    return this._page;\n  }\n  set page(_) {\n    throw new Error("field.page is read-only");\n  }\n  get rotation() {\n    return this._rotation;\n  }\n  set rotation(angle) {\n    angle = Math.floor(angle);\n    if (angle % 90 !== 0) {\n      throw new Error("Invalid rotation: must be a multiple of 90");\n    }\n    angle %= 360;\n    if (angle < 0) {\n      angle += 360;\n    }\n    this._rotation = angle;\n  }\n  get textColor() {\n    return this._textColor;\n  }\n  set textColor(color) {\n    if (Color._isValidColor(color)) {\n      this._textColor = color;\n    }\n  }\n  get fgColor() {\n    return this.textColor;\n  }\n  set fgColor(color) {\n    this.textColor = color;\n  }\n  get value() {\n    return this._value;\n  }\n  set value(value) {\n    if (this._isChoice) {\n      this._setChoiceValue(value);\n      return;\n    }\n    if (this._hasDateOrTime && value) {\n      const date = this._util.scand(this._datetimeFormat, value);\n      if (date) {\n        this._originalValue = date.valueOf();\n        value = this._util.printd(this._datetimeFormat, date);\n        this._value = !isNaN(value) ? parseFloat(value) : value;\n        return;\n      }\n    }\n    if (value === "" || typeof value !== "string" || this._fieldType >= FieldType.date) {\n      this._originalValue = undefined;\n      this._value = value;\n      return;\n    }\n    this._originalValue = value;\n    const _value = value.trim().replace(",", ".");\n    this._value = !isNaN(_value) ? parseFloat(_value) : value;\n  }\n  get _initialValue() {\n    return this._hasDateOrTime && this._originalValue || null;\n  }\n  _getValue() {\n    return this._originalValue ?? this.value;\n  }\n  _setChoiceValue(value) {\n    if (this.multipleSelection) {\n      if (!Array.isArray(value)) {\n        value = [value];\n      }\n      const values = new Set(value);\n      if (Array.isArray(this._currentValueIndices)) {\n        this._currentValueIndices.length = 0;\n        this._value.length = 0;\n      } else {\n        this._currentValueIndices = [];\n        this._value = [];\n      }\n      this._items.forEach((item, i) => {\n        if (values.has(item.exportValue)) {\n          this._currentValueIndices.push(i);\n          this._value.push(item.exportValue);\n        }\n      });\n    } else {\n      if (Array.isArray(value)) {\n        value = value[0];\n      }\n      const index = this._items.findIndex(({\n        exportValue\n      }) => value === exportValue);\n      if (index !== -1) {\n        this._currentValueIndices = index;\n        this._value = this._items[index].exportValue;\n      }\n    }\n  }\n  get valueAsString() {\n    return (this._value ?? "").toString();\n  }\n  set valueAsString(_) {}\n  browseForFileToSubmit() {\n    if (this._browseForFileToSubmit) {\n      this._browseForFileToSubmit();\n    }\n  }\n  buttonGetCaption(nFace = 0) {\n    if (this._buttonCaption) {\n      return this._buttonCaption[nFace];\n    }\n    return "";\n  }\n  buttonGetIcon(nFace = 0) {\n    if (this._buttonIcon) {\n      return this._buttonIcon[nFace];\n    }\n    return null;\n  }\n  buttonImportIcon(cPath = null, nPave = 0) {}\n  buttonSetCaption(cCaption, nFace = 0) {\n    if (!this._buttonCaption) {\n      this._buttonCaption = ["", "", ""];\n    }\n    this._buttonCaption[nFace] = cCaption;\n  }\n  buttonSetIcon(oIcon, nFace = 0) {\n    if (!this._buttonIcon) {\n      this._buttonIcon = [null, null, null];\n    }\n    this._buttonIcon[nFace] = oIcon;\n  }\n  checkThisBox(nWidget, bCheckIt = true) {}\n  clearItems() {\n    if (!this._isChoice) {\n      throw new Error("Not a choice widget");\n    }\n    this._items = [];\n    this._send({\n      id: this._id,\n      clear: null\n    });\n  }\n  deleteItemAt(nIdx = null) {\n    if (!this._isChoice) {\n      throw new Error("Not a choice widget");\n    }\n    if (!this.numItems) {\n      return;\n    }\n    if (nIdx === null) {\n      nIdx = Array.isArray(this._currentValueIndices) ? this._currentValueIndices[0] : this._currentValueIndices;\n      nIdx ||= 0;\n    }\n    if (nIdx < 0 || nIdx >= this.numItems) {\n      nIdx = this.numItems - 1;\n    }\n    this._items.splice(nIdx, 1);\n    if (Array.isArray(this._currentValueIndices)) {\n      let index = this._currentValueIndices.findIndex(i => i >= nIdx);\n      if (index !== -1) {\n        if (this._currentValueIndices[index] === nIdx) {\n          this._currentValueIndices.splice(index, 1);\n        }\n        for (const ii = this._currentValueIndices.length; index < ii; index++) {\n          --this._currentValueIndices[index];\n        }\n      }\n    } else if (this._currentValueIndices === nIdx) {\n      this._currentValueIndices = this.numItems > 0 ? 0 : -1;\n    } else if (this._currentValueIndices > nIdx) {\n      --this._currentValueIndices;\n    }\n    this._send({\n      id: this._id,\n      remove: nIdx\n    });\n  }\n  getItemAt(nIdx = -1, bExportValue = false) {\n    if (!this._isChoice) {\n      throw new Error("Not a choice widget");\n    }\n    if (nIdx < 0 || nIdx >= this.numItems) {\n      nIdx = this.numItems - 1;\n    }\n    const item = this._items[nIdx];\n    return bExportValue ? item.exportValue : item.displayValue;\n  }\n  getArray() {\n    if (this._kidIds) {\n      const array = [];\n      const fillArrayWithKids = kidIds => {\n        for (const id of kidIds) {\n          const obj = this._appObjects[id];\n          if (!obj) {\n            continue;\n          }\n          if (obj.obj._hasValue) {\n            array.push(obj.wrapped);\n          }\n          if (obj.obj._kidIds) {\n            fillArrayWithKids(obj.obj._kidIds);\n          }\n        }\n      };\n      fillArrayWithKids(this._kidIds);\n      return array;\n    }\n    return this._children ??= this._document.obj._getTerminalChildren(this._fieldPath);\n  }\n  getLock() {\n    return undefined;\n  }\n  isBoxChecked(nWidget) {\n    return false;\n  }\n  isDefaultChecked(nWidget) {\n    return false;\n  }\n  insertItemAt(cName, cExport = undefined, nIdx = 0) {\n    if (!this._isChoice) {\n      throw new Error("Not a choice widget");\n    }\n    if (!cName) {\n      return;\n    }\n    if (nIdx < 0 || nIdx > this.numItems) {\n      nIdx = this.numItems;\n    }\n    if (this._items.some(({\n      displayValue\n    }) => displayValue === cName)) {\n      return;\n    }\n    if (cExport === undefined) {\n      cExport = cName;\n    }\n    const data = {\n      displayValue: cName,\n      exportValue: cExport\n    };\n    this._items.splice(nIdx, 0, data);\n    if (Array.isArray(this._currentValueIndices)) {\n      let index = this._currentValueIndices.findIndex(i => i >= nIdx);\n      if (index !== -1) {\n        for (const ii = this._currentValueIndices.length; index < ii; index++) {\n          ++this._currentValueIndices[index];\n        }\n      }\n    } else if (this._currentValueIndices >= nIdx) {\n      ++this._currentValueIndices;\n    }\n    this._send({\n      id: this._id,\n      insert: {\n        index: nIdx,\n        ...data\n      }\n    });\n  }\n  setAction(cTrigger, cScript) {\n    if (typeof cTrigger !== "string" || typeof cScript !== "string") {\n      return;\n    }\n    if (!(cTrigger in this._actions)) {\n      this._actions[cTrigger] = [];\n    }\n    this._actions[cTrigger].push(cScript);\n  }\n  setFocus() {\n    this._send({\n      id: this._id,\n      focus: true\n    });\n  }\n  setItems(oArray) {\n    if (!this._isChoice) {\n      throw new Error("Not a choice widget");\n    }\n    this._items.length = 0;\n    for (const element of oArray) {\n      let displayValue, exportValue;\n      if (Array.isArray(element)) {\n        displayValue = element[0]?.toString() || "";\n        exportValue = element[1]?.toString() || "";\n      } else {\n        displayValue = exportValue = element?.toString() || "";\n      }\n      this._items.push({\n        displayValue,\n        exportValue\n      });\n    }\n    this._currentValueIndices = 0;\n    this._send({\n      id: this._id,\n      items: this._items\n    });\n  }\n  setLock() {}\n  signatureGetModifications() {}\n  signatureGetSeedValue() {}\n  signatureInfo() {}\n  signatureSetSeedValue() {}\n  signatureSign() {}\n  signatureValidate() {}\n  _isButton() {\n    return false;\n  }\n  _reset() {\n    this.value = this.defaultValue;\n  }\n  _runActions(event) {\n    const eventName = event.name;\n    if (!this._actions.has(eventName)) {\n      return false;\n    }\n    const actions = this._actions.get(eventName);\n    for (const action of actions) {\n      try {\n        this._globalEval(action);\n      } catch (error) {\n        const serializedError = serializeError(error);\n        serializedError.value = `Error when executing "${eventName}" for field "${this._id}"\\n${serializedError.value}`;\n        this._send(serializedError);\n      }\n    }\n    return true;\n  }\n}\nclass RadioButtonField extends Field {\n  constructor(otherButtons, data) {\n    super(data);\n    this.exportValues = [this.exportValues];\n    this._radioIds = [this._id];\n    this._radioActions = [this._actions];\n    for (const radioData of otherButtons) {\n      this.exportValues.push(radioData.exportValues);\n      this._radioIds.push(radioData.id);\n      this._radioActions.push(createActionsMap(radioData.actions));\n      if (this._value === radioData.exportValues) {\n        this._id = radioData.id;\n      }\n    }\n    this._hasBeenInitialized = true;\n    this._value = data.value || "";\n  }\n  get _siblings() {\n    return this._radioIds.filter(id => id !== this._id);\n  }\n  set _siblings(_) {}\n  get value() {\n    return this._value;\n  }\n  set value(value) {\n    if (!this._hasBeenInitialized) {\n      return;\n    }\n    if (value === null || value === undefined) {\n      this._value = "";\n    }\n    const i = this.exportValues.indexOf(value);\n    if (0 <= i && i < this._radioIds.length) {\n      this._id = this._radioIds[i];\n      this._value = value;\n    } else if (value === "Off" && this._radioIds.length === 2) {\n      const nextI = (1 + this._radioIds.indexOf(this._id)) % 2;\n      this._id = this._radioIds[nextI];\n      this._value = this.exportValues[nextI];\n    }\n  }\n  checkThisBox(nWidget, bCheckIt = true) {\n    if (nWidget < 0 || nWidget >= this._radioIds.length || !bCheckIt) {\n      return;\n    }\n    this._id = this._radioIds[nWidget];\n    this._value = this.exportValues[nWidget];\n    this._send({\n      id: this._id,\n      value: this._value\n    });\n  }\n  isBoxChecked(nWidget) {\n    return nWidget >= 0 && nWidget < this._radioIds.length && this._id === this._radioIds[nWidget];\n  }\n  isDefaultChecked(nWidget) {\n    return nWidget >= 0 && nWidget < this.exportValues.length && this.defaultValue === this.exportValues[nWidget];\n  }\n  _getExportValue(state) {\n    const i = this._radioIds.indexOf(this._id);\n    return this.exportValues[i];\n  }\n  _runActions(event) {\n    const i = this._radioIds.indexOf(this._id);\n    this._actions = this._radioActions[i];\n    return super._runActions(event);\n  }\n  _isButton() {\n    return true;\n  }\n}\nclass CheckboxField extends RadioButtonField {\n  get value() {\n    return this._value;\n  }\n  set value(value) {\n    if (!value || value === "Off") {\n      this._value = "Off";\n    } else {\n      super.value = value;\n    }\n  }\n  _getExportValue(state) {\n    return state ? super._getExportValue(state) : "Off";\n  }\n  isBoxChecked(nWidget) {\n    if (this._value === "Off") {\n      return false;\n    }\n    return super.isBoxChecked(nWidget);\n  }\n  isDefaultChecked(nWidget) {\n    if (this.defaultValue === "Off") {\n      return this._value === "Off";\n    }\n    return super.isDefaultChecked(nWidget);\n  }\n  checkThisBox(nWidget, bCheckIt = true) {\n    if (nWidget < 0 || nWidget >= this._radioIds.length) {\n      return;\n    }\n    this._id = this._radioIds[nWidget];\n    this._value = bCheckIt ? this.exportValues[nWidget] : "Off";\n    this._send({\n      id: this._id,\n      value: this._value\n    });\n  }\n}\n\n// EXTERNAL MODULE: ./node_modules/core-js/modules/es.iterator.reduce.js\nvar es_iterator_reduce = __webpack_require__(8237);\n// EXTERNAL MODULE: ./node_modules/core-js/modules/es.math.sum-precise.js\nvar es_math_sum_precise = __webpack_require__(3068);\n;// ./src/scripting_api/aform.js\n\n\n\n\n\n\n\n\n\nclass AForm {\n  constructor(document, app, util, color) {\n    this._document = document;\n    this._app = app;\n    this._util = util;\n    this._color = color;\n    this._emailRegex = new RegExp("^[\\\\w.!#$%&\'*+/=?^`{|}~-]+" + "@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?" + "(?:\\\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$");\n  }\n  _mkTargetName(event) {\n    return event.target ? `[ ${event.target.name} ]` : "";\n  }\n  _parseDate(cFormat, cDate) {\n    let date = null;\n    try {\n      date = this._util._scand(cFormat, cDate, false);\n    } catch {}\n    if (date) {\n      return date;\n    }\n    date = Date.parse(cDate);\n    return isNaN(date) ? null : new Date(date);\n  }\n  AFMergeChange(event = globalThis.event) {\n    if (event.willCommit) {\n      return event.value.toString();\n    }\n    return this._app._eventDispatcher.mergeChange(event);\n  }\n  AFParseDateEx(cString, cOrder) {\n    return this._parseDate(cOrder, cString);\n  }\n  AFExtractNums(str) {\n    if (typeof str === "number") {\n      return [str];\n    }\n    if (!str || typeof str !== "string") {\n      return null;\n    }\n    const first = str.charAt(0);\n    if (first === "." || first === ",") {\n      str = `0${str}`;\n    }\n    const numbers = str.match(/(\\d+)/g);\n    if (numbers.length === 0) {\n      return null;\n    }\n    return numbers;\n  }\n  AFMakeNumber(str) {\n    if (typeof str === "number") {\n      return str;\n    }\n    if (typeof str !== "string") {\n      return null;\n    }\n    str = str.trim().replace(",", ".");\n    const number = parseFloat(str);\n    if (isNaN(number) || !isFinite(number)) {\n      return null;\n    }\n    return number;\n  }\n  AFMakeArrayFromList(string) {\n    if (typeof string === "string") {\n      return string.split(/, ?/g);\n    }\n    return string;\n  }\n  AFNumber_Format(nDec, sepStyle, negStyle, currStyle, strCurrency, bCurrencyPrepend) {\n    const event = globalThis.event;\n    let value = this.AFMakeNumber(event.value);\n    if (value === null) {\n      event.value = "";\n      return;\n    }\n    const sign = Math.sign(value);\n    const buf = [];\n    let hasParen = false;\n    if (sign === -1 && bCurrencyPrepend && negStyle === 0) {\n      buf.push("-");\n    }\n    if ((negStyle === 2 || negStyle === 3) && sign === -1) {\n      buf.push("(");\n      hasParen = true;\n    }\n    if (bCurrencyPrepend) {\n      buf.push(strCurrency);\n    }\n    sepStyle = MathClamp(Math.floor(sepStyle), 0, 4);\n    buf.push("%,", sepStyle, ".", nDec.toString(), "f");\n    if (!bCurrencyPrepend) {\n      buf.push(strCurrency);\n    }\n    if (hasParen) {\n      buf.push(")");\n    }\n    if (negStyle === 1 || negStyle === 3) {\n      event.target.textColor = sign === 1 ? this._color.black : this._color.red;\n    }\n    if ((negStyle !== 0 || bCurrencyPrepend) && sign === -1) {\n      value = -value;\n    }\n    const formatStr = buf.join("");\n    event.value = this._util.printf(formatStr, value);\n  }\n  AFNumber_Keystroke(nDec, sepStyle, negStyle, currStyle, strCurrency, bCurrencyPrepend) {\n    const event = globalThis.event;\n    let value = this.AFMergeChange(event);\n    if (!value) {\n      return;\n    }\n    value = value.trim();\n    let pattern;\n    if (sepStyle > 1) {\n      pattern = event.willCommit ? /^[+-]?(\\d+(,\\d*)?|,\\d+)$/ : /^[+-]?\\d*(?:,\\d*)?$/;\n    } else {\n      pattern = event.willCommit ? /^[+-]?(\\d+(\\.\\d*)?|\\.\\d+)$/ : /^[+-]?\\d*(?:\\.\\d*)?$/;\n    }\n    if (!pattern.test(value)) {\n      if (event.willCommit) {\n        const err = `${GlobalConstants.IDS_INVALID_VALUE} ${this._mkTargetName(event)}`;\n        this._app.alert(err);\n      }\n      event.rc = false;\n    }\n    if (event.willCommit && sepStyle > 1) {\n      event.value = parseFloat(value.replace(",", "."));\n    }\n  }\n  AFPercent_Format(nDec, sepStyle, percentPrepend = false) {\n    if (typeof nDec !== "number") {\n      return;\n    }\n    if (typeof sepStyle !== "number") {\n      return;\n    }\n    if (nDec < 0) {\n      throw new Error("Invalid nDec value in AFPercent_Format");\n    }\n    const event = globalThis.event;\n    if (nDec > 512) {\n      event.value = "%";\n      return;\n    }\n    nDec = Math.floor(nDec);\n    sepStyle = MathClamp(Math.floor(sepStyle), 0, 4);\n    let value = this.AFMakeNumber(event.value);\n    if (value === null) {\n      event.value = "%";\n      return;\n    }\n    const formatStr = `%,${sepStyle}.${nDec}f`;\n    value = this._util.printf(formatStr, value * 100);\n    event.value = percentPrepend ? `%${value}` : `${value}%`;\n  }\n  AFPercent_Keystroke(nDec, sepStyle) {\n    this.AFNumber_Keystroke(nDec, sepStyle, 0, 0, "", true);\n  }\n  AFDate_FormatEx(cFormat) {\n    const event = globalThis.event;\n    const value = event.value;\n    if (!value) {\n      return;\n    }\n    const date = this._parseDate(cFormat, value);\n    if (date !== null) {\n      event.value = this._util.printd(cFormat, date);\n    }\n  }\n  AFDate_Format(pdf) {\n    this.AFDate_FormatEx(DateFormats[pdf] ?? pdf);\n  }\n  AFDate_KeystrokeEx(cFormat) {\n    const event = globalThis.event;\n    if (!event.willCommit) {\n      return;\n    }\n    const value = this.AFMergeChange(event);\n    if (!value) {\n      return;\n    }\n    if (this._parseDate(cFormat, value) === null) {\n      const invalid = GlobalConstants.IDS_INVALID_DATE;\n      const invalid2 = GlobalConstants.IDS_INVALID_DATE2;\n      const err = `${invalid} ${this._mkTargetName(event)}${invalid2}${cFormat}`;\n      this._app.alert(err);\n      event.rc = false;\n    }\n  }\n  AFDate_Keystroke(pdf) {\n    if (pdf >= 0 && pdf < DateFormats.length) {\n      this.AFDate_KeystrokeEx(DateFormats[pdf]);\n    }\n  }\n  AFRange_Validate(bGreaterThan, nGreaterThan, bLessThan, nLessThan) {\n    const event = globalThis.event;\n    if (!event.value) {\n      return;\n    }\n    const value = this.AFMakeNumber(event.value);\n    if (value === null) {\n      return;\n    }\n    bGreaterThan = !!bGreaterThan;\n    bLessThan = !!bLessThan;\n    if (bGreaterThan) {\n      nGreaterThan = this.AFMakeNumber(nGreaterThan);\n      if (nGreaterThan === null) {\n        return;\n      }\n    }\n    if (bLessThan) {\n      nLessThan = this.AFMakeNumber(nLessThan);\n      if (nLessThan === null) {\n        return;\n      }\n    }\n    let err = "";\n    if (bGreaterThan && bLessThan) {\n      if (value < nGreaterThan || value > nLessThan) {\n        err = this._util.printf(GlobalConstants.IDS_GT_AND_LT, nGreaterThan, nLessThan);\n      }\n    } else if (bGreaterThan) {\n      if (value < nGreaterThan) {\n        err = this._util.printf(GlobalConstants.IDS_GREATER_THAN, nGreaterThan);\n      }\n    } else if (value > nLessThan) {\n      err = this._util.printf(GlobalConstants.IDS_LESS_THAN, nLessThan);\n    }\n    if (err) {\n      this._app.alert(err);\n      event.rc = false;\n    }\n  }\n  AFSimple(cFunction, nValue1, nValue2) {\n    const value1 = this.AFMakeNumber(nValue1);\n    if (value1 === null) {\n      throw new Error("Invalid nValue1 in AFSimple");\n    }\n    const value2 = this.AFMakeNumber(nValue2);\n    if (value2 === null) {\n      throw new Error("Invalid nValue2 in AFSimple");\n    }\n    switch (cFunction) {\n      case "AVG":\n        return (value1 + value2) / 2;\n      case "SUM":\n        return value1 + value2;\n      case "PRD":\n        return value1 * value2;\n      case "MIN":\n        return Math.min(value1, value2);\n      case "MAX":\n        return Math.max(value1, value2);\n    }\n    throw new Error("Invalid cFunction in AFSimple");\n  }\n  AFSimple_Calculate(cFunction, cFields) {\n    const actions = {\n      AVG: args => Math.sumPrecise(args) / args.length,\n      SUM: args => Math.sumPrecise(args),\n      PRD: args => args.reduce((acc, value) => acc * value, 1),\n      MIN: args => Math.min(...args),\n      MAX: args => Math.max(...args)\n    };\n    if (!(cFunction in actions)) {\n      throw new TypeError("Invalid function in AFSimple_Calculate");\n    }\n    const event = globalThis.event;\n    const values = [];\n    cFields = this.AFMakeArrayFromList(cFields);\n    for (const cField of cFields) {\n      const field = this._document.getField(cField);\n      if (!field) {\n        continue;\n      }\n      for (const child of field.getArray()) {\n        const number = this.AFMakeNumber(child.value);\n        values.push(number ?? 0);\n      }\n    }\n    if (values.length === 0) {\n      event.value = 0;\n      return;\n    }\n    const res = actions[cFunction](values);\n    event.value = Math.round(1e6 * res) / 1e6;\n  }\n  AFSpecial_Format(psf) {\n    const event = globalThis.event;\n    if (!event.value) {\n      return;\n    }\n    psf = this.AFMakeNumber(psf);\n    let formatStr;\n    switch (psf) {\n      case 0:\n        formatStr = "99999";\n        break;\n      case 1:\n        formatStr = "99999-9999";\n        break;\n      case 2:\n        formatStr = this._util.printx("9999999999", event.value).length >= 10 ? "(999) 999-9999" : "999-9999";\n        break;\n      case 3:\n        formatStr = "999-99-9999";\n        break;\n      default:\n        throw new Error("Invalid psf in AFSpecial_Format");\n    }\n    event.value = this._util.printx(formatStr, event.value);\n  }\n  AFSpecial_KeystrokeEx(cMask) {\n    const event = globalThis.event;\n    const simplifiedFormatStr = cMask.replaceAll(/[^9AOX]/g, "");\n    this.#AFSpecial_KeystrokeEx_helper(simplifiedFormatStr, null, false);\n    if (event.rc) {\n      return;\n    }\n    event.rc = true;\n    this.#AFSpecial_KeystrokeEx_helper(cMask, null, true);\n  }\n  #AFSpecial_KeystrokeEx_helper(cMask, value, warn) {\n    if (!cMask) {\n      return;\n    }\n    const event = globalThis.event;\n    value ||= this.AFMergeChange(event);\n    if (!value) {\n      return;\n    }\n    const checkers = new Map([["9", char => char >= "0" && char <= "9"], ["A", char => "a" <= char && char <= "z" || "A" <= char && char <= "Z"], ["O", char => "a" <= char && char <= "z" || "A" <= char && char <= "Z" || "0" <= char && char <= "9"], ["X", char => true]]);\n    function _checkValidity(_value, _cMask) {\n      for (let i = 0, ii = _value.length; i < ii; i++) {\n        const mask = _cMask.charAt(i);\n        const char = _value.charAt(i);\n        const checker = checkers.get(mask);\n        if (checker) {\n          if (!checker(char)) {\n            return false;\n          }\n        } else if (mask !== char) {\n          return false;\n        }\n      }\n      return true;\n    }\n    const err = `${GlobalConstants.IDS_INVALID_VALUE} = "${cMask}"`;\n    if (value.length > cMask.length) {\n      if (warn) {\n        this._app.alert(err);\n      }\n      event.rc = false;\n      return;\n    }\n    if (event.willCommit) {\n      if (value.length < cMask.length) {\n        if (warn) {\n          this._app.alert(err);\n        }\n        event.rc = false;\n        return;\n      }\n      if (!_checkValidity(value, cMask)) {\n        if (warn) {\n          this._app.alert(err);\n        }\n        event.rc = false;\n        return;\n      }\n      event.value += cMask.substring(value.length);\n      return;\n    }\n    if (value.length < cMask.length) {\n      cMask = cMask.substring(0, value.length);\n    }\n    if (!_checkValidity(value, cMask)) {\n      if (warn) {\n        this._app.alert(err);\n      }\n      event.rc = false;\n    }\n  }\n  AFSpecial_Keystroke(psf) {\n    const event = globalThis.event;\n    psf = this.AFMakeNumber(psf);\n    let value = this.AFMergeChange(event);\n    let formatStr, secondFormatStr;\n    switch (psf) {\n      case 0:\n        formatStr = "99999";\n        break;\n      case 1:\n        formatStr = "99999-9999";\n        break;\n      case 2:\n        formatStr = "999-9999";\n        secondFormatStr = "(999) 999-9999";\n        break;\n      case 3:\n        formatStr = "999-99-9999";\n        break;\n      default:\n        throw new Error("Invalid psf in AFSpecial_Keystroke");\n    }\n    const formats = secondFormatStr ? [formatStr, secondFormatStr] : [formatStr];\n    for (const format of formats) {\n      this.#AFSpecial_KeystrokeEx_helper(format, value, false);\n      if (event.rc) {\n        return;\n      }\n      event.rc = true;\n    }\n    const re = /[-()\\s]+/g;\n    value = value.replaceAll(re, "");\n    for (const format of formats) {\n      this.#AFSpecial_KeystrokeEx_helper(format.replaceAll(re, ""), value, false);\n      if (event.rc) {\n        return;\n      }\n      event.rc = true;\n    }\n    this.AFSpecial_KeystrokeEx((secondFormatStr && value.match(/\\d/g) || []).length > 7 ? secondFormatStr : formatStr);\n  }\n  AFTime_FormatEx(cFormat) {\n    this.AFDate_FormatEx(cFormat);\n  }\n  AFTime_Format(pdf) {\n    this.AFDate_FormatEx(TimeFormats[pdf] ?? pdf);\n  }\n  AFTime_KeystrokeEx(cFormat) {\n    this.AFDate_KeystrokeEx(cFormat);\n  }\n  AFTime_Keystroke(pdf) {\n    if (pdf >= 0 && pdf < TimeFormats.length) {\n      this.AFDate_KeystrokeEx(TimeFormats[pdf]);\n    }\n  }\n  eMailValidate(str) {\n    return this._emailRegex.test(str);\n  }\n  AFExactMatch(rePatterns, str) {\n    if (rePatterns instanceof RegExp) {\n      return str.match(rePatterns)?.[0] === str || 0;\n    }\n    return rePatterns.findIndex(re => str.match(re)?.[0] === str) + 1;\n  }\n}\n\n// EXTERNAL MODULE: ./node_modules/core-js/modules/es.array.includes.js\nvar es_array_includes = __webpack_require__(4423);\n// EXTERNAL MODULE: ./node_modules/core-js/modules/es.weak-map.get-or-insert.js\nvar es_weak_map_get_or_insert = __webpack_require__(8454);\n// EXTERNAL MODULE: ./node_modules/core-js/modules/es.weak-map.get-or-insert-computed.js\nvar es_weak_map_get_or_insert_computed = __webpack_require__(9452);\n;// ./src/scripting_api/event.js\n\n\nclass Event {\n  constructor(data) {\n    this.change = data.change || "";\n    this.changeEx = data.changeEx || null;\n    this.commitKey = data.commitKey || 0;\n    this.fieldFull = data.fieldFull || false;\n    this.keyDown = data.keyDown || false;\n    this.modifier = data.modifier || false;\n    this.name = data.name;\n    this.rc = true;\n    this.richChange = data.richChange || [];\n    this.richChangeEx = data.richChangeEx || [];\n    this.richValue = data.richValue || [];\n    this.selEnd = data.selEnd ?? -1;\n    this.selStart = data.selStart ?? -1;\n    this.shift = data.shift || false;\n    this.source = data.source || null;\n    this.target = data.target || null;\n    this.targetName = "";\n    this.type = "Field";\n    this.value = data.value || "";\n    this.willCommit = data.willCommit || false;\n  }\n}\nclass EventDispatcher {\n  constructor(document, calculationOrder, objects, externalCall) {\n    this._document = document;\n    this._calculationOrder = calculationOrder;\n    this._objects = objects;\n    this._externalCall = externalCall;\n    this._document.obj._eventDispatcher = this;\n    this._isCalculating = false;\n  }\n  mergeChange(event) {\n    let value = event.value;\n    if (Array.isArray(value)) {\n      return value;\n    }\n    if (typeof value !== "string") {\n      value = value.toString();\n    }\n    const prefix = event.selStart >= 0 ? value.substring(0, event.selStart) : "";\n    const postfix = event.selEnd >= 0 && event.selEnd <= value.length ? value.substring(event.selEnd) : "";\n    return `${prefix}${event.change}${postfix}`;\n  }\n  userActivation() {\n    this._document.obj._userActivation = true;\n    this._externalCall("setTimeout", [USERACTIVATION_CALLBACKID, USERACTIVATION_MAXTIME_VALIDITY]);\n  }\n  dispatch(baseEvent) {\n    const id = baseEvent.id;\n    if (!(id in this._objects)) {\n      let event;\n      if (id === "doc" || id === "page") {\n        event = globalThis.event = new Event(baseEvent);\n        event.source = event.target = this._document.wrapped;\n        event.name = baseEvent.name;\n      }\n      if (id === "doc") {\n        const eventName = event.name;\n        if (eventName === "Open") {\n          this.userActivation();\n          this._document.obj._initActions();\n          this.formatAll();\n        }\n        if (!["DidPrint", "DidSave", "WillPrint", "WillSave"].includes(eventName)) {\n          this.userActivation();\n        }\n        this._document.obj._dispatchDocEvent(event.name);\n      } else if (id === "page") {\n        this.userActivation();\n        this._document.obj._dispatchPageEvent(event.name, baseEvent.actions, baseEvent.pageNumber);\n      } else if (id === "app" && baseEvent.name === "ResetForm") {\n        this.userActivation();\n        for (const fieldId of baseEvent.ids) {\n          const obj = this._objects[fieldId];\n          obj?.obj._reset();\n        }\n      }\n      return;\n    }\n    const name = baseEvent.name;\n    const source = this._objects[id];\n    const event = globalThis.event = new Event(baseEvent);\n    let savedChange;\n    this.userActivation();\n    if (source.obj._isButton()) {\n      source.obj._id = id;\n      event.value = source.obj._getExportValue(event.value);\n      if (name === "Action") {\n        source.obj._value = event.value;\n      }\n    }\n    switch (name) {\n      case "Keystroke":\n        savedChange = {\n          value: event.value,\n          changeEx: event.changeEx,\n          change: event.change,\n          selStart: event.selStart,\n          selEnd: event.selEnd\n        };\n        break;\n      case "Blur":\n      case "Focus":\n        Object.defineProperty(event, "value", {\n          configurable: false,\n          writable: false,\n          enumerable: true,\n          value: event.value\n        });\n        break;\n      case "Validate":\n        this.runValidation(source, event);\n        return;\n      case "Action":\n        this.runActions(source, source, event, name);\n        this.runCalculate(source, event);\n        return;\n    }\n    this.runActions(source, source, event, name);\n    if (name !== "Keystroke") {\n      return;\n    }\n    if (event.rc) {\n      if (event.willCommit) {\n        this.runValidation(source, event);\n      } else {\n        if (source.obj._isChoice) {\n          source.obj.value = savedChange.changeEx;\n          source.obj._send({\n            id: source.obj._id,\n            siblings: source.obj._siblings,\n            value: source.obj.value\n          });\n          return;\n        }\n        const value = source.obj.value = this.mergeChange(event);\n        let selStart, selEnd;\n        if (event.selStart !== savedChange.selStart || event.selEnd !== savedChange.selEnd) {\n          selStart = event.selStart;\n          selEnd = event.selEnd;\n        } else {\n          selEnd = selStart = savedChange.selStart + event.change.length;\n        }\n        source.obj._send({\n          id: source.obj._id,\n          siblings: source.obj._siblings,\n          value,\n          selRange: [selStart, selEnd]\n        });\n      }\n    } else if (!event.willCommit) {\n      source.obj._send({\n        id: source.obj._id,\n        siblings: source.obj._siblings,\n        value: savedChange.value,\n        selRange: [savedChange.selStart, savedChange.selEnd]\n      });\n    } else {\n      source.obj._send({\n        id: source.obj._id,\n        siblings: source.obj._siblings,\n        value: "",\n        formattedValue: null,\n        selRange: [0, 0]\n      });\n    }\n  }\n  formatAll() {\n    const event = globalThis.event = new Event({});\n    for (const source of Object.values(this._objects)) {\n      event.value = source.obj._getValue();\n      this.runActions(source, source, event, "Format");\n    }\n  }\n  runValidation(source, event) {\n    const didValidateRun = this.runActions(source, source, event, "Validate");\n    if (event.rc) {\n      source.obj.value = event.value;\n      this.runCalculate(source, event);\n      const savedValue = event.value = source.obj._getValue();\n      const formattedValue = this.runActions(source, source, event, "Format") ? event.value?.toString?.() : null;\n      source.obj._send({\n        id: source.obj._id,\n        siblings: source.obj._siblings,\n        value: savedValue,\n        formattedValue\n      });\n      event.value = savedValue;\n    } else if (didValidateRun) {\n      source.obj._send({\n        id: source.obj._id,\n        siblings: source.obj._siblings,\n        value: "",\n        formattedValue: null,\n        selRange: [0, 0],\n        focus: true\n      });\n    }\n  }\n  runActions(source, target, event, eventName) {\n    event.source = source.wrapped;\n    event.target = target.wrapped;\n    event.name = eventName;\n    event.targetName = target.obj.name;\n    event.rc = true;\n    return target.obj._runActions(event);\n  }\n  calculateNow() {\n    if (!this._calculationOrder || this._isCalculating || !this._document.obj.calculate) {\n      return;\n    }\n    this._isCalculating = true;\n    const first = this._calculationOrder[0];\n    const source = this._objects[first];\n    globalThis.event = new Event({});\n    this.runCalculate(source, globalThis.event);\n    this._isCalculating = false;\n  }\n  runCalculate(source, event) {\n    if (!this._calculationOrder || !this._document.obj.calculate) {\n      return;\n    }\n    for (const targetId of this._calculationOrder) {\n      if (!(targetId in this._objects)) {\n        continue;\n      }\n      if (!this._document.obj.calculate) {\n        break;\n      }\n      event.value = null;\n      const target = this._objects[targetId];\n      let savedValue = target.obj._getValue();\n      this.runActions(source, target, event, "Calculate");\n      if (!event.rc) {\n        continue;\n      }\n      if (event.value !== null) {\n        target.obj.value = event.value;\n      } else {\n        event.value = target.obj._getValue();\n      }\n      this.runActions(target, target, event, "Validate");\n      if (!event.rc) {\n        if (target.obj._getValue() !== savedValue) {\n          target.wrapped.value = savedValue;\n        }\n        continue;\n      }\n      if (event.value === null) {\n        event.value = target.obj._getValue();\n      }\n      savedValue = target.obj._getValue();\n      const formattedValue = this.runActions(target, target, event, "Format") ? event.value?.toString?.() : null;\n      target.obj._send({\n        id: target.obj._id,\n        siblings: target.obj._siblings,\n        value: savedValue,\n        formattedValue\n      });\n    }\n  }\n}\n\n;// ./src/scripting_api/fullscreen.js\n\n\nclass FullScreen extends PDFObject {\n  _backgroundColor = [];\n  _clickAdvances = true;\n  _cursor = Cursor.hidden;\n  _defaultTransition = "";\n  _escapeExits = true;\n  _isFullScreen = true;\n  _loop = false;\n  _timeDelay = 3600;\n  _usePageTiming = false;\n  _useTimer = false;\n  get backgroundColor() {\n    return this._backgroundColor;\n  }\n  set backgroundColor(_) {}\n  get clickAdvances() {\n    return this._clickAdvances;\n  }\n  set clickAdvances(_) {}\n  get cursor() {\n    return this._cursor;\n  }\n  set cursor(_) {}\n  get defaultTransition() {\n    return this._defaultTransition;\n  }\n  set defaultTransition(_) {}\n  get escapeExits() {\n    return this._escapeExits;\n  }\n  set escapeExits(_) {}\n  get isFullScreen() {\n    return this._isFullScreen;\n  }\n  set isFullScreen(_) {}\n  get loop() {\n    return this._loop;\n  }\n  set loop(_) {}\n  get timeDelay() {\n    return this._timeDelay;\n  }\n  set timeDelay(_) {}\n  get transitions() {\n    return ["Replace", "WipeRight", "WipeLeft", "WipeDown", "WipeUp", "SplitHorizontalIn", "SplitHorizontalOut", "SplitVerticalIn", "SplitVerticalOut", "BlindsHorizontal", "BlindsVertical", "BoxIn", "BoxOut", "GlitterRight", "GlitterDown", "GlitterRightDown", "Dissolve", "Random"];\n  }\n  set transitions(_) {\n    throw new Error("fullscreen.transitions is read-only");\n  }\n  get usePageTiming() {\n    return this._usePageTiming;\n  }\n  set usePageTiming(_) {}\n  get useTimer() {\n    return this._useTimer;\n  }\n  set useTimer(_) {}\n}\n\n;// ./src/scripting_api/thermometer.js\n\nclass Thermometer extends PDFObject {\n  _cancelled = false;\n  _duration = 100;\n  _text = "";\n  _value = 0;\n  get cancelled() {\n    return this._cancelled;\n  }\n  set cancelled(_) {\n    throw new Error("thermometer.cancelled is read-only");\n  }\n  get duration() {\n    return this._duration;\n  }\n  set duration(val) {\n    this._duration = val;\n  }\n  get text() {\n    return this._text;\n  }\n  set text(val) {\n    this._text = val;\n  }\n  get value() {\n    return this._value;\n  }\n  set value(val) {\n    this._value = val;\n  }\n  begin() {}\n  end() {}\n}\n\n;// ./src/scripting_api/app.js\n\n\n\n\n\n\n\n\n\n\n\nclass App extends PDFObject {\n  constructor(data) {\n    super(data);\n    this._constants = null;\n    this._focusRect = true;\n    this._fs = null;\n    this._language = App._getLanguage(data.language);\n    this._openInPlace = false;\n    this._platform = App._getPlatform(data.platform);\n    this._runtimeHighlight = false;\n    this._runtimeHighlightColor = ["T"];\n    this._thermometer = null;\n    this._toolbar = false;\n    this._document = data._document;\n    this._proxyHandler = data.proxyHandler;\n    this._objects = Object.create(null);\n    this._eventDispatcher = new EventDispatcher(this._document, data.calculationOrder, this._objects, data.externalCall);\n    this._timeoutIds = new WeakMap();\n    this._timeoutIdsRegistry = new FinalizationRegistry(this._cleanTimeout.bind(this));\n    this._timeoutCallbackIds = new Map();\n    this._timeoutCallbackId = USERACTIVATION_CALLBACKID + 1;\n    this._globalEval = data.globalEval;\n    this._externalCall = data.externalCall;\n  }\n  _dispatchEvent(pdfEvent) {\n    this._eventDispatcher.dispatch(pdfEvent);\n  }\n  _registerTimeoutCallback(cExpr) {\n    const id = this._timeoutCallbackId++;\n    this._timeoutCallbackIds.set(id, cExpr);\n    return id;\n  }\n  _unregisterTimeoutCallback(id) {\n    this._timeoutCallbackIds.delete(id);\n  }\n  _evalCallback({\n    callbackId,\n    interval\n  }) {\n    const documentObj = this._document.obj;\n    if (callbackId === USERACTIVATION_CALLBACKID) {\n      documentObj._userActivation = false;\n      return;\n    }\n    const expr = this._timeoutCallbackIds.get(callbackId);\n    if (!interval) {\n      this._unregisterTimeoutCallback(callbackId);\n    }\n    if (expr) {\n      const saveUserActivation = documentObj._userActivation;\n      documentObj._userActivation = false;\n      this._globalEval(expr);\n      documentObj._userActivation = saveUserActivation;\n    }\n  }\n  _registerTimeout(callbackId, interval) {\n    const timeout = Object.create(null);\n    const id = {\n      callbackId,\n      interval\n    };\n    this._timeoutIds.set(timeout, id);\n    this._timeoutIdsRegistry.register(timeout, id);\n    return timeout;\n  }\n  _unregisterTimeout(timeout) {\n    this._timeoutIdsRegistry.unregister(timeout);\n    const data = this._timeoutIds.get(timeout);\n    if (!data) {\n      return;\n    }\n    this._timeoutIds.delete(timeout);\n    this._cleanTimeout(data);\n  }\n  _cleanTimeout({\n    callbackId,\n    interval\n  }) {\n    this._unregisterTimeoutCallback(callbackId);\n    if (interval) {\n      this._externalCall("clearInterval", [callbackId]);\n    } else {\n      this._externalCall("clearTimeout", [callbackId]);\n    }\n  }\n  static _getPlatform(platform) {\n    if (typeof platform === "string") {\n      platform = platform.toLowerCase();\n      if (platform.includes("win")) {\n        return "WIN";\n      } else if (platform.includes("mac")) {\n        return "MAC";\n      }\n    }\n    return "UNIX";\n  }\n  static _getLanguage(language) {\n    const [main, sub] = language.toLowerCase().split(/[-_]/, 2);\n    switch (main) {\n      case "zh":\n        return sub === "cn" || sub === "sg" ? "CHS" : "CHT";\n      case "da":\n        return "DAN";\n      case "de":\n        return "DEU";\n      case "es":\n        return "ESP";\n      case "fr":\n        return "FRA";\n      case "it":\n        return "ITA";\n      case "ko":\n        return "KOR";\n      case "ja":\n        return "JPN";\n      case "nl":\n        return "NLD";\n      case "no":\n        return "NOR";\n      case "pt":\n        return sub === "br" ? "PTB" : "ENU";\n      case "fi":\n        return "SUO";\n      case "SV":\n        return "SVE";\n      default:\n        return "ENU";\n    }\n  }\n  get activeDocs() {\n    return [this._document.wrapped];\n  }\n  set activeDocs(_) {\n    throw new Error("app.activeDocs is read-only");\n  }\n  get calculate() {\n    return this._document.obj.calculate;\n  }\n  set calculate(calculate) {\n    this._document.obj.calculate = calculate;\n  }\n  get constants() {\n    return this._constants ??= Object.freeze({\n      align: Object.freeze({\n        left: 0,\n        center: 1,\n        right: 2,\n        top: 3,\n        bottom: 4\n      })\n    });\n  }\n  set constants(_) {\n    throw new Error("app.constants is read-only");\n  }\n  get focusRect() {\n    return this._focusRect;\n  }\n  set focusRect(val) {\n    this._focusRect = val;\n  }\n  get formsVersion() {\n    return FORMS_VERSION;\n  }\n  set formsVersion(_) {\n    throw new Error("app.formsVersion is read-only");\n  }\n  get fromPDFConverters() {\n    return [];\n  }\n  set fromPDFConverters(_) {\n    throw new Error("app.fromPDFConverters is read-only");\n  }\n  get fs() {\n    return this._fs ??= new Proxy(new FullScreen({\n      send: this._send\n    }), this._proxyHandler);\n  }\n  set fs(_) {\n    throw new Error("app.fs is read-only");\n  }\n  get language() {\n    return this._language;\n  }\n  set language(_) {\n    throw new Error("app.language is read-only");\n  }\n  get media() {\n    return undefined;\n  }\n  set media(_) {\n    throw new Error("app.media is read-only");\n  }\n  get monitors() {\n    return [];\n  }\n  set monitors(_) {\n    throw new Error("app.monitors is read-only");\n  }\n  get numPlugins() {\n    return 0;\n  }\n  set numPlugins(_) {\n    throw new Error("app.numPlugins is read-only");\n  }\n  get openInPlace() {\n    return this._openInPlace;\n  }\n  set openInPlace(val) {\n    this._openInPlace = val;\n  }\n  get platform() {\n    return this._platform;\n  }\n  set platform(_) {\n    throw new Error("app.platform is read-only");\n  }\n  get plugins() {\n    return [];\n  }\n  set plugins(_) {\n    throw new Error("app.plugins is read-only");\n  }\n  get printColorProfiles() {\n    return [];\n  }\n  set printColorProfiles(_) {\n    throw new Error("app.printColorProfiles is read-only");\n  }\n  get printerNames() {\n    return [];\n  }\n  set printerNames(_) {\n    throw new Error("app.printerNames is read-only");\n  }\n  get runtimeHighlight() {\n    return this._runtimeHighlight;\n  }\n  set runtimeHighlight(val) {\n    this._runtimeHighlight = val;\n  }\n  get runtimeHighlightColor() {\n    return this._runtimeHighlightColor;\n  }\n  set runtimeHighlightColor(val) {\n    if (Color._isValidColor(val)) {\n      this._runtimeHighlightColor = val;\n    }\n  }\n  get thermometer() {\n    return this._thermometer ??= new Proxy(new Thermometer({\n      send: this._send\n    }), this._proxyHandler);\n  }\n  set thermometer(_) {\n    throw new Error("app.thermometer is read-only");\n  }\n  get toolbar() {\n    return this._toolbar;\n  }\n  set toolbar(val) {\n    this._toolbar = val;\n  }\n  get toolbarHorizontal() {\n    return this.toolbar;\n  }\n  set toolbarHorizontal(value) {\n    this.toolbar = value;\n  }\n  get toolbarVertical() {\n    return this.toolbar;\n  }\n  set toolbarVertical(value) {\n    this.toolbar = value;\n  }\n  get viewerType() {\n    return VIEWER_TYPE;\n  }\n  set viewerType(_) {\n    throw new Error("app.viewerType is read-only");\n  }\n  get viewerVariation() {\n    return VIEWER_VARIATION;\n  }\n  set viewerVariation(_) {\n    throw new Error("app.viewerVariation is read-only");\n  }\n  get viewerVersion() {\n    return VIEWER_VERSION;\n  }\n  set viewerVersion(_) {\n    throw new Error("app.viewerVersion is read-only");\n  }\n  addMenuItem() {}\n  addSubMenu() {}\n  addToolButton() {}\n  alert(cMsg, nIcon = 0, nType = 0, cTitle = "PDF.js", oDoc = null, oCheckbox = null) {\n    if (!this._document.obj._userActivation) {\n      return 0;\n    }\n    this._document.obj._userActivation = false;\n    if (cMsg && typeof cMsg === "object") {\n      nType = cMsg.nType;\n      cMsg = cMsg.cMsg;\n    }\n    cMsg = (cMsg || "").toString();\n    if (!cMsg) {\n      return 0;\n    }\n    nType = typeof nType !== "number" || isNaN(nType) || nType < 0 || nType > 3 ? 0 : nType;\n    if (nType >= 2) {\n      return this._externalCall("confirm", [cMsg]) ? 4 : 3;\n    }\n    this._externalCall("alert", [cMsg]);\n    return 1;\n  }\n  beep() {}\n  beginPriv() {}\n  browseForDoc() {}\n  clearInterval(oInterval) {\n    this._unregisterTimeout(oInterval);\n  }\n  clearTimeOut(oTime) {\n    this._unregisterTimeout(oTime);\n  }\n  endPriv() {}\n  execDialog() {}\n  execMenuItem(item) {\n    if (!this._document.obj._userActivation) {\n      return;\n    }\n    this._document.obj._userActivation = false;\n    switch (item) {\n      case "SaveAs":\n        if (this._document.obj._disableSaving) {\n          return;\n        }\n        this._send({\n          command: item\n        });\n        break;\n      case "FirstPage":\n      case "LastPage":\n      case "NextPage":\n      case "PrevPage":\n      case "ZoomViewIn":\n      case "ZoomViewOut":\n        this._send({\n          command: item\n        });\n        break;\n      case "FitPage":\n        this._send({\n          command: "zoom",\n          value: "page-fit"\n        });\n        break;\n      case "Print":\n        if (this._document.obj._disablePrinting) {\n          return;\n        }\n        this._send({\n          command: "print"\n        });\n        break;\n    }\n  }\n  getNthPlugInName() {}\n  getPath() {}\n  goBack() {}\n  goForward() {}\n  hideMenuItem() {}\n  hideToolbarButton() {}\n  launchURL() {}\n  listMenuItems() {}\n  listToolbarButtons() {}\n  loadPolicyFile() {}\n  mailGetAddrs() {}\n  mailMsg() {}\n  newDoc() {}\n  newCollection() {}\n  newFDF() {}\n  openDoc() {}\n  openFDF() {}\n  popUpMenu() {}\n  popUpMenuEx() {}\n  removeToolButton() {}\n  response(cQuestion, cTitle = "", cDefault = "", bPassword = "", cLabel = "") {\n    if (!this._document.obj._userActivation) {\n      return null;\n    }\n    this._document.obj._userActivation = false;\n    if (cQuestion && typeof cQuestion === "object") {\n      cDefault = cQuestion.cDefault;\n      cQuestion = cQuestion.cQuestion;\n    }\n    cQuestion = (cQuestion || "").toString();\n    cDefault = (cDefault || "").toString();\n    return this._externalCall("prompt", [cQuestion, cDefault || ""]);\n  }\n  setInterval(cExpr, nMilliseconds = 0) {\n    if (cExpr && typeof cExpr === "object") {\n      nMilliseconds = cExpr.nMilliseconds || 0;\n      cExpr = cExpr.cExpr;\n    }\n    if (typeof cExpr !== "string") {\n      throw new TypeError("First argument of app.setInterval must be a string");\n    }\n    if (typeof nMilliseconds !== "number") {\n      throw new TypeError("Second argument of app.setInterval must be a number");\n    }\n    const callbackId = this._registerTimeoutCallback(cExpr);\n    this._externalCall("setInterval", [callbackId, nMilliseconds]);\n    return this._registerTimeout(callbackId, true);\n  }\n  setTimeOut(cExpr, nMilliseconds = 0) {\n    if (cExpr && typeof cExpr === "object") {\n      nMilliseconds = cExpr.nMilliseconds || 0;\n      cExpr = cExpr.cExpr;\n    }\n    if (typeof cExpr !== "string") {\n      throw new TypeError("First argument of app.setTimeOut must be a string");\n    }\n    if (typeof nMilliseconds !== "number") {\n      throw new TypeError("Second argument of app.setTimeOut must be a number");\n    }\n    const callbackId = this._registerTimeoutCallback(cExpr);\n    this._externalCall("setTimeout", [callbackId, nMilliseconds]);\n    return this._registerTimeout(callbackId, false);\n  }\n  trustedFunction() {}\n  trustPropagatorFunction() {}\n}\n\n// EXTERNAL MODULE: ./node_modules/core-js/modules/es.json.stringify.js\nvar es_json_stringify = __webpack_require__(3110);\n;// ./src/scripting_api/console.js\n\n\nclass Console extends PDFObject {\n  clear() {\n    this._send({\n      id: "clear"\n    });\n  }\n  hide() {}\n  println(msg) {\n    if (typeof msg !== "string") {\n      try {\n        msg = JSON.stringify(msg);\n      } catch {\n        msg = msg.toString?.() || "[Unserializable object]";\n      }\n    }\n    this._send({\n      command: "println",\n      value: "PDF.js Console:: " + msg\n    });\n  }\n  show() {}\n}\n\n;// ./src/scripting_api/print_params.js\nclass PrintParams {\n  binaryOk = true;\n  bitmapDPI = 150;\n  booklet = {\n    binding: 0,\n    duplexMode: 0,\n    subsetFrom: 0,\n    subsetTo: -1\n  };\n  colorOverride = 0;\n  colorProfile = "";\n  constants = Object.freeze({\n    bookletBindings: Object.freeze({\n      Left: 0,\n      Right: 1,\n      LeftTall: 2,\n      RightTall: 3\n    }),\n    bookletDuplexMode: Object.freeze({\n      BothSides: 0,\n      FrontSideOnly: 1,\n      BasicSideOnly: 2\n    }),\n    colorOverrides: Object.freeze({\n      auto: 0,\n      gray: 1,\n      mono: 2\n    }),\n    fontPolicies: Object.freeze({\n      everyPage: 0,\n      jobStart: 1,\n      pageRange: 2\n    }),\n    handling: Object.freeze({\n      none: 0,\n      fit: 1,\n      shrink: 2,\n      tileAll: 3,\n      tileLarge: 4,\n      nUp: 5,\n      booklet: 6\n    }),\n    interactionLevel: Object.freeze({\n      automatic: 0,\n      full: 1,\n      silent: 2\n    }),\n    nUpPageOrders: Object.freeze({\n      Horizontal: 0,\n      HorizontalReversed: 1,\n      Vertical: 2\n    }),\n    printContents: Object.freeze({\n      doc: 0,\n      docAndComments: 1,\n      formFieldsOnly: 2\n    }),\n    flagValues: Object.freeze({\n      applyOverPrint: 1,\n      applySoftProofSettings: 1 << 1,\n      applyWorkingColorSpaces: 1 << 2,\n      emitHalftones: 1 << 3,\n      emitPostScriptXObjects: 1 << 4,\n      emitFormsAsPSForms: 1 << 5,\n      maxJP2KRes: 1 << 6,\n      setPageSize: 1 << 7,\n      suppressBG: 1 << 8,\n      suppressCenter: 1 << 9,\n      suppressCJKFontSubst: 1 << 10,\n      suppressCropClip: 1 << 11,\n      suppressRotate: 1 << 12,\n      suppressTransfer: 1 << 13,\n      suppressUCR: 1 << 14,\n      useTrapAnnots: 1 << 15,\n      usePrintersMarks: 1 << 16\n    }),\n    rasterFlagValues: Object.freeze({\n      textToOutline: 1,\n      strokesToOutline: 1 << 1,\n      allowComplexClip: 1 << 2,\n      preserveOverprint: 1 << 3\n    }),\n    subsets: Object.freeze({\n      all: 0,\n      even: 1,\n      odd: 2\n    }),\n    tileMarks: Object.freeze({\n      none: 0,\n      west: 1,\n      east: 2\n    }),\n    usages: Object.freeze({\n      auto: 0,\n      use: 1,\n      noUse: 2\n    })\n  });\n  downloadFarEastFonts = false;\n  fileName = "";\n  firstPage = 0;\n  flags = 0;\n  fontPolicy = 0;\n  gradientDPI = 150;\n  interactive = 1;\n  npUpAutoRotate = false;\n  npUpNumPagesH = 2;\n  npUpNumPagesV = 2;\n  npUpPageBorder = false;\n  npUpPageOrder = 0;\n  pageHandling = 0;\n  pageSubset = 0;\n  printAsImage = false;\n  printContent = 0;\n  printerName = "";\n  psLevel = 0;\n  rasterFlags = 0;\n  reversePages = false;\n  tileLabel = false;\n  tileMark = 0;\n  tileOverlap = 0;\n  tileScale = 1.0;\n  transparencyLevel = 75;\n  usePrinterCRD = 0;\n  useT1Conversion = 0;\n  constructor(data) {\n    this.lastPage = data.lastPage;\n  }\n}\n\n;// ./src/scripting_api/doc.js\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nconst DOC_EXTERNAL = false;\nclass InfoProxyHandler {\n  static get(obj, prop) {\n    return obj[prop.toLowerCase()];\n  }\n  static set(obj, prop, value) {\n    throw new Error(`doc.info.${prop} is read-only`);\n  }\n}\nclass Doc extends PDFObject {\n  #pageActions = null;\n  #otherPageActions = null;\n  constructor(data) {\n    super(data);\n    this._expandos = globalThis;\n    this._baseURL = data.baseURL || "";\n    this._calculate = true;\n    this._delay = false;\n    this._dirty = false;\n    this._disclosed = false;\n    this._media = undefined;\n    this._metadata = data.metadata || "";\n    this._noautocomplete = undefined;\n    this._nocache = undefined;\n    this._spellDictionaryOrder = [];\n    this._spellLanguageOrder = [];\n    this._printParams = null;\n    this._fields = new Map();\n    this._fieldNames = [];\n    this._event = null;\n    this._author = data.Author || "";\n    this._creator = data.Creator || "";\n    this._creationDate = this._getDate(data.CreationDate) || null;\n    this._docID = data.docID || ["", ""];\n    this._documentFileName = data.filename || "";\n    this._filesize = data.filesize || 0;\n    this._keywords = data.Keywords || "";\n    this._layout = data.layout || "";\n    this._modDate = this._getDate(data.ModDate) || null;\n    this._numFields = 0;\n    this._numPages = data.numPages || 1;\n    this._pageNum = data.pageNum || 0;\n    this._producer = data.Producer || "";\n    this._securityHandler = data.EncryptFilterName || null;\n    this._subject = data.Subject || "";\n    this._title = data.Title || "";\n    this._URL = data.URL || "";\n    this._info = new Proxy({\n      title: this._title,\n      author: this._author,\n      authors: data.authors || [this._author],\n      subject: this._subject,\n      keywords: this._keywords,\n      creator: this._creator,\n      producer: this._producer,\n      creationdate: this._creationDate,\n      moddate: this._modDate,\n      trapped: data.Trapped || "Unknown"\n    }, InfoProxyHandler);\n    this._zoomType = ZoomType.none;\n    this._zoom = data.zoom || 100;\n    this._actions = createActionsMap(data.actions);\n    this._globalEval = data.globalEval;\n    this._userActivation = false;\n    this._disablePrinting = false;\n    this._disableSaving = false;\n  }\n  _initActions() {\n    for (const {\n      obj\n    } of this._fields.values()) {\n      const initialValue = obj._initialValue;\n      if (initialValue) {\n        this._send({\n          id: obj._id,\n          siblings: obj._siblings,\n          value: initialValue,\n          formattedValue: obj.value.toString()\n        });\n      }\n    }\n    const dontRun = new Set(["WillClose", "WillSave", "DidSave", "WillPrint", "DidPrint", "OpenAction"]);\n    this._disableSaving = true;\n    for (const actionName of this._actions.keys()) {\n      if (!dontRun.has(actionName)) {\n        this._runActions(actionName);\n      }\n    }\n    this._runActions("OpenAction");\n    this._disableSaving = false;\n  }\n  _dispatchDocEvent(name) {\n    switch (name) {\n      case "Open":\n        this._disableSaving = true;\n        this._runActions("OpenAction");\n        this._disableSaving = false;\n        break;\n      case "WillPrint":\n        this._disablePrinting = true;\n        try {\n          this._runActions(name);\n        } catch (error) {\n          this._send(serializeError(error));\n        }\n        this._send({\n          command: "WillPrintFinished"\n        });\n        this._disablePrinting = false;\n        break;\n      case "WillSave":\n        this._disableSaving = true;\n        this._runActions(name);\n        this._disableSaving = false;\n        break;\n      default:\n        this._runActions(name);\n    }\n  }\n  _dispatchPageEvent(name, actions, pageNumber) {\n    if (name === "PageOpen") {\n      this.#pageActions ??= new Map();\n      if (!this.#pageActions.has(pageNumber)) {\n        this.#pageActions.set(pageNumber, createActionsMap(actions));\n      }\n      this._pageNum = pageNumber - 1;\n    }\n    for (const acts of [this.#pageActions, this.#otherPageActions]) {\n      actions = acts?.get(pageNumber)?.get(name);\n      if (actions) {\n        for (const action of actions) {\n          this._globalEval(action);\n        }\n      }\n    }\n  }\n  _runActions(name) {\n    const actions = this._actions.get(name);\n    if (!actions) {\n      return;\n    }\n    for (const action of actions) {\n      try {\n        this._globalEval(action);\n      } catch (error) {\n        const serializedError = serializeError(error);\n        serializedError.value = `Error when executing "${name}" for document\\n${serializedError.value}`;\n        this._send(serializedError);\n      }\n    }\n  }\n  _addField(name, field) {\n    this._fields.set(name, field);\n    this._fieldNames.push(name);\n    this._numFields++;\n    const po = field.obj._actions.get("PageOpen");\n    const pc = field.obj._actions.get("PageClose");\n    if (po || pc) {\n      this.#otherPageActions ??= new Map();\n      const actions = this.#otherPageActions.getOrInsertComputed(field.obj._page + 1, makeMap);\n      if (po) {\n        actions.getOrInsertComputed("PageOpen", makeArr).push(...po);\n      }\n      if (pc) {\n        actions.getOrInsertComputed("PageClose", makeArr).push(...pc);\n      }\n    }\n  }\n  _getDate(date) {\n    if (!date || date.length < 15 || !date.startsWith("D:")) {\n      return date;\n    }\n    date = date.substring(2);\n    const year = date.substring(0, 4);\n    const month = date.substring(4, 6);\n    const day = date.substring(6, 8);\n    const hour = date.substring(8, 10);\n    const minute = date.substring(10, 12);\n    const o = date.charAt(12);\n    let second, offsetPos;\n    if (o === "Z" || o === "+" || o === "-") {\n      second = "00";\n      offsetPos = 12;\n    } else {\n      second = date.substring(12, 14);\n      offsetPos = 14;\n    }\n    const offset = date.substring(offsetPos).replaceAll("\'", "");\n    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);\n  }\n  get author() {\n    return this._author;\n  }\n  set author(_) {\n    throw new Error("doc.author is read-only");\n  }\n  get baseURL() {\n    return this._baseURL;\n  }\n  set baseURL(baseURL) {\n    this._baseURL = baseURL;\n  }\n  get bookmarkRoot() {\n    return undefined;\n  }\n  set bookmarkRoot(_) {\n    throw new Error("doc.bookmarkRoot is read-only");\n  }\n  get calculate() {\n    return this._calculate;\n  }\n  set calculate(calculate) {\n    this._calculate = calculate;\n  }\n  get creator() {\n    return this._creator;\n  }\n  set creator(_) {\n    throw new Error("doc.creator is read-only");\n  }\n  get dataObjects() {\n    return [];\n  }\n  set dataObjects(_) {\n    throw new Error("doc.dataObjects is read-only");\n  }\n  get delay() {\n    return this._delay;\n  }\n  set delay(delay) {\n    this._delay = delay;\n  }\n  get dirty() {\n    return this._dirty;\n  }\n  set dirty(dirty) {\n    this._dirty = dirty;\n  }\n  get disclosed() {\n    return this._disclosed;\n  }\n  set disclosed(disclosed) {\n    this._disclosed = disclosed;\n  }\n  get docID() {\n    return this._docID;\n  }\n  set docID(_) {\n    throw new Error("doc.docID is read-only");\n  }\n  get documentFileName() {\n    return this._documentFileName;\n  }\n  set documentFileName(_) {\n    throw new Error("doc.documentFileName is read-only");\n  }\n  get dynamicXFAForm() {\n    return false;\n  }\n  set dynamicXFAForm(_) {\n    throw new Error("doc.dynamicXFAForm is read-only");\n  }\n  get external() {\n    return DOC_EXTERNAL;\n  }\n  set external(_) {\n    throw new Error("doc.external is read-only");\n  }\n  get filesize() {\n    return this._filesize;\n  }\n  set filesize(_) {\n    throw new Error("doc.filesize is read-only");\n  }\n  get hidden() {\n    return false;\n  }\n  set hidden(_) {\n    throw new Error("doc.hidden is read-only");\n  }\n  get hostContainer() {\n    return undefined;\n  }\n  set hostContainer(_) {\n    throw new Error("doc.hostContainer is read-only");\n  }\n  get icons() {\n    return undefined;\n  }\n  set icons(_) {\n    throw new Error("doc.icons is read-only");\n  }\n  get info() {\n    return this._info;\n  }\n  set info(_) {\n    throw new Error("doc.info is read-only");\n  }\n  get innerAppWindowRect() {\n    return [0, 0, 0, 0];\n  }\n  set innerAppWindowRect(_) {\n    throw new Error("doc.innerAppWindowRect is read-only");\n  }\n  get innerDocWindowRect() {\n    return [0, 0, 0, 0];\n  }\n  set innerDocWindowRect(_) {\n    throw new Error("doc.innerDocWindowRect is read-only");\n  }\n  get isModal() {\n    return false;\n  }\n  set isModal(_) {\n    throw new Error("doc.isModal is read-only");\n  }\n  get keywords() {\n    return this._keywords;\n  }\n  set keywords(_) {\n    throw new Error("doc.keywords is read-only");\n  }\n  get layout() {\n    return this._layout;\n  }\n  set layout(value) {\n    if (!this._userActivation) {\n      return;\n    }\n    this._userActivation = false;\n    if (typeof value !== "string") {\n      return;\n    }\n    if (value !== "SinglePage" && value !== "OneColumn" && value !== "TwoColumnLeft" && value !== "TwoPageLeft" && value !== "TwoColumnRight" && value !== "TwoPageRight") {\n      value = "SinglePage";\n    }\n    this._send({\n      command: "layout",\n      value\n    });\n    this._layout = value;\n  }\n  get media() {\n    return this._media;\n  }\n  set media(media) {\n    this._media = media;\n  }\n  get metadata() {\n    return this._metadata;\n  }\n  set metadata(metadata) {\n    this._metadata = metadata;\n  }\n  get modDate() {\n    return this._modDate;\n  }\n  set modDate(_) {\n    throw new Error("doc.modDate is read-only");\n  }\n  get mouseX() {\n    return 0;\n  }\n  set mouseX(_) {\n    throw new Error("doc.mouseX is read-only");\n  }\n  get mouseY() {\n    return 0;\n  }\n  set mouseY(_) {\n    throw new Error("doc.mouseY is read-only");\n  }\n  get noautocomplete() {\n    return this._noautocomplete;\n  }\n  set noautocomplete(noautocomplete) {\n    this._noautocomplete = noautocomplete;\n  }\n  get nocache() {\n    return this._nocache;\n  }\n  set nocache(nocache) {\n    this._nocache = nocache;\n  }\n  get numFields() {\n    return this._numFields;\n  }\n  set numFields(_) {\n    throw new Error("doc.numFields is read-only");\n  }\n  get numPages() {\n    return this._numPages;\n  }\n  set numPages(_) {\n    throw new Error("doc.numPages is read-only");\n  }\n  get numTemplates() {\n    return 0;\n  }\n  set numTemplates(_) {\n    throw new Error("doc.numTemplates is read-only");\n  }\n  get outerAppWindowRect() {\n    return [0, 0, 0, 0];\n  }\n  set outerAppWindowRect(_) {\n    throw new Error("doc.outerAppWindowRect is read-only");\n  }\n  get outerDocWindowRect() {\n    return [0, 0, 0, 0];\n  }\n  set outerDocWindowRect(_) {\n    throw new Error("doc.outerDocWindowRect is read-only");\n  }\n  get pageNum() {\n    return this._pageNum;\n  }\n  set pageNum(value) {\n    if (!this._userActivation) {\n      return;\n    }\n    this._userActivation = false;\n    if (typeof value !== "number" || value < 0 || value >= this._numPages) {\n      return;\n    }\n    this._send({\n      command: "page-num",\n      value\n    });\n    this._pageNum = value;\n  }\n  get pageWindowRect() {\n    return [0, 0, 0, 0];\n  }\n  set pageWindowRect(_) {\n    throw new Error("doc.pageWindowRect is read-only");\n  }\n  get path() {\n    return "";\n  }\n  set path(_) {\n    throw new Error("doc.path is read-only");\n  }\n  get permStatusReady() {\n    return true;\n  }\n  set permStatusReady(_) {\n    throw new Error("doc.permStatusReady is read-only");\n  }\n  get producer() {\n    return this._producer;\n  }\n  set producer(_) {\n    throw new Error("doc.producer is read-only");\n  }\n  get requiresFullSave() {\n    return false;\n  }\n  set requiresFullSave(_) {\n    throw new Error("doc.requiresFullSave is read-only");\n  }\n  get securityHandler() {\n    return this._securityHandler;\n  }\n  set securityHandler(_) {\n    throw new Error("doc.securityHandler is read-only");\n  }\n  get selectedAnnots() {\n    return [];\n  }\n  set selectedAnnots(_) {\n    throw new Error("doc.selectedAnnots is read-only");\n  }\n  get sounds() {\n    return [];\n  }\n  set sounds(_) {\n    throw new Error("doc.sounds is read-only");\n  }\n  get spellDictionaryOrder() {\n    return this._spellDictionaryOrder;\n  }\n  set spellDictionaryOrder(spellDictionaryOrder) {\n    this._spellDictionaryOrder = spellDictionaryOrder;\n  }\n  get spellLanguageOrder() {\n    return this._spellLanguageOrder;\n  }\n  set spellLanguageOrder(spellLanguageOrder) {\n    this._spellLanguageOrder = spellLanguageOrder;\n  }\n  get subject() {\n    return this._subject;\n  }\n  set subject(_) {\n    throw new Error("doc.subject is read-only");\n  }\n  get templates() {\n    return [];\n  }\n  set templates(_) {\n    throw new Error("doc.templates is read-only");\n  }\n  get title() {\n    return this._title;\n  }\n  set title(_) {\n    throw new Error("doc.title is read-only");\n  }\n  get URL() {\n    return this._URL;\n  }\n  set URL(_) {\n    throw new Error("doc.URL is read-only");\n  }\n  get viewState() {\n    return undefined;\n  }\n  set viewState(_) {\n    throw new Error("doc.viewState is read-only");\n  }\n  get xfa() {\n    return this._xfa;\n  }\n  set xfa(_) {\n    throw new Error("doc.xfa is read-only");\n  }\n  get XFAForeground() {\n    return false;\n  }\n  set XFAForeground(_) {\n    throw new Error("doc.XFAForeground is read-only");\n  }\n  get zoomType() {\n    return this._zoomType;\n  }\n  set zoomType(type) {\n    if (!this._userActivation) {\n      return;\n    }\n    this._userActivation = false;\n    if (typeof type !== "string") {\n      return;\n    }\n    switch (type) {\n      case ZoomType.none:\n        this._send({\n          command: "zoom",\n          value: 1\n        });\n        break;\n      case ZoomType.fitP:\n        this._send({\n          command: "zoom",\n          value: "page-fit"\n        });\n        break;\n      case ZoomType.fitW:\n        this._send({\n          command: "zoom",\n          value: "page-width"\n        });\n        break;\n      case ZoomType.fitH:\n        this._send({\n          command: "zoom",\n          value: "page-height"\n        });\n        break;\n      case ZoomType.fitV:\n        this._send({\n          command: "zoom",\n          value: "auto"\n        });\n        break;\n      case ZoomType.pref:\n      case ZoomType.refW:\n        break;\n      default:\n        return;\n    }\n    this._zoomType = type;\n  }\n  get zoom() {\n    return this._zoom;\n  }\n  set zoom(value) {\n    if (!this._userActivation) {\n      return;\n    }\n    this._userActivation = false;\n    if (typeof value !== "number" || value < 8.33 || value > 6400) {\n      return;\n    }\n    this._send({\n      command: "zoom",\n      value: value / 100\n    });\n  }\n  addAnnot() {}\n  addField() {}\n  addIcon() {}\n  addLink() {}\n  addRecipientListCryptFilter() {}\n  addRequirement() {}\n  addScript() {}\n  addThumbnails() {}\n  addWatermarkFromFile() {}\n  addWatermarkFromText() {}\n  addWeblinks() {}\n  bringToFront() {}\n  calculateNow() {\n    this._eventDispatcher.calculateNow();\n  }\n  closeDoc() {}\n  colorConvertPage() {}\n  createDataObject() {}\n  createTemplate() {}\n  deletePages() {}\n  deleteSound() {}\n  embedDocAsDataObject() {}\n  embedOutputIntent() {}\n  encryptForRecipients() {}\n  encryptUsingPolicy() {}\n  exportAsFDF() {}\n  exportAsFDFStr() {}\n  exportAsText() {}\n  exportAsXFDF() {}\n  exportAsXFDFStr() {}\n  exportDataObject() {}\n  exportXFAData() {}\n  extractPages() {}\n  flattenPages() {}\n  getAnnot() {}\n  getAnnots() {}\n  getAnnot3D() {}\n  getAnnots3D() {}\n  getColorConvertAction() {}\n  getDataObject() {}\n  getDataObjectContents() {}\n  _getField(cName) {\n    if (cName && typeof cName === "object") {\n      cName = cName.cName;\n    }\n    if (typeof cName !== "string") {\n      throw new TypeError("Invalid field name: must be a string");\n    }\n    const searchedField = this._fields.get(cName);\n    if (searchedField) {\n      return searchedField;\n    }\n    const parts = cName.split("#");\n    let childIndex = NaN;\n    if (parts.length === 2) {\n      childIndex = Math.floor(parseFloat(parts[1]));\n      cName = parts[0];\n    }\n    for (const [name, field] of this._fields) {\n      if (name.endsWith(cName)) {\n        if (!isNaN(childIndex)) {\n          const children = this._getChildren(name);\n          if (childIndex < 0 || childIndex >= children.length) {\n            childIndex = 0;\n          }\n          if (childIndex < children.length) {\n            this._fields.set(cName, children[childIndex]);\n            return children[childIndex];\n          }\n        }\n        this._fields.set(cName, field);\n        return field;\n      }\n    }\n    return null;\n  }\n  getField(cName) {\n    const field = this._getField(cName);\n    if (!field) {\n      return null;\n    }\n    return field.wrapped;\n  }\n  _getChildren(fieldName) {\n    const len = fieldName.length;\n    const children = [];\n    const pattern = /^\\.[^.]+$/;\n    for (const [name, field] of this._fields) {\n      if (name.startsWith(fieldName)) {\n        const finalPart = name.slice(len);\n        if (pattern.test(finalPart)) {\n          children.push(field);\n        }\n      }\n    }\n    return children;\n  }\n  _getTerminalChildren(fieldName) {\n    const children = [];\n    const len = fieldName.length;\n    for (const [name, field] of this._fields) {\n      if (name.startsWith(fieldName)) {\n        const finalPart = name.slice(len);\n        if (field.obj._hasValue && (finalPart === "" || finalPart.startsWith("."))) {\n          children.push(field.wrapped);\n        }\n      }\n    }\n    return children;\n  }\n  getIcon() {}\n  getLegalWarnings() {}\n  getLinks() {}\n  getNthFieldName(nIndex) {\n    if (nIndex && typeof nIndex === "object") {\n      nIndex = nIndex.nIndex;\n    }\n    if (typeof nIndex !== "number") {\n      throw new TypeError("Invalid field index: must be a number");\n    }\n    if (0 <= nIndex && nIndex < this.numFields) {\n      return this._fieldNames[Math.trunc(nIndex)];\n    }\n    return null;\n  }\n  getNthTemplate() {\n    return null;\n  }\n  getOCGs() {}\n  getOCGOrder() {}\n  getPageBox() {}\n  getPageLabel() {}\n  getPageNthWord() {}\n  getPageNthWordQuads() {}\n  getPageNumWords() {}\n  getPageRotation() {}\n  getPageTransition() {}\n  getPrintParams() {\n    return this._printParams ||= new PrintParams({\n      lastPage: this._numPages - 1\n    });\n  }\n  getSound() {}\n  getTemplate() {}\n  getURL() {}\n  gotoNamedDest() {}\n  importAnFDF() {}\n  importAnXFDF() {}\n  importDataObject() {}\n  importIcon() {}\n  importSound() {}\n  importTextData() {}\n  importXFAData() {}\n  insertPages() {}\n  mailDoc() {}\n  mailForm() {}\n  movePage() {}\n  newPage() {}\n  openDataObject() {}\n  print(bUI = true, nStart = 0, nEnd = -1, bSilent = false, bShrinkToFit = false, bPrintAsImage = false, bReverse = false, bAnnotations = true, printParams = null) {\n    if (this._disablePrinting || !this._userActivation) {\n      return;\n    }\n    this._userActivation = false;\n    if (bUI && typeof bUI === "object") {\n      nStart = bUI.nStart;\n      nEnd = bUI.nEnd;\n      bSilent = bUI.bSilent;\n      bShrinkToFit = bUI.bShrinkToFit;\n      bPrintAsImage = bUI.bPrintAsImage;\n      bReverse = bUI.bReverse;\n      bAnnotations = bUI.bAnnotations;\n      printParams = bUI.printParams;\n      bUI = bUI.bUI;\n    }\n    if (printParams) {\n      nStart = printParams.firstPage;\n      nEnd = printParams.lastPage;\n    }\n    nStart = typeof nStart === "number" ? Math.max(0, Math.trunc(nStart)) : 0;\n    nEnd = typeof nEnd === "number" ? Math.max(0, Math.trunc(nEnd)) : -1;\n    this._send({\n      command: "print",\n      start: nStart,\n      end: nEnd\n    });\n  }\n  removeDataObject() {}\n  removeField() {}\n  removeIcon() {}\n  removeLinks() {}\n  removeRequirement() {}\n  removeScript() {}\n  removeTemplate() {}\n  removeThumbnails() {}\n  removeWeblinks() {}\n  replacePages() {}\n  resetForm(aFields = null) {\n    if (aFields && typeof aFields === "object" && !Array.isArray(aFields)) {\n      aFields = aFields.aFields;\n    }\n    if (aFields && !Array.isArray(aFields)) {\n      aFields = [aFields];\n    }\n    let mustCalculate = false;\n    let fieldsToReset;\n    if (aFields) {\n      fieldsToReset = [];\n      for (const fieldName of aFields) {\n        if (!fieldName) {\n          continue;\n        }\n        if (typeof fieldName !== "string") {\n          fieldsToReset = null;\n          break;\n        }\n        const field = this._getField(fieldName);\n        if (!field) {\n          continue;\n        }\n        fieldsToReset.push(field);\n        mustCalculate = true;\n      }\n    }\n    if (!fieldsToReset) {\n      fieldsToReset = this._fields.values();\n      mustCalculate = this._fields.size !== 0;\n    }\n    for (const field of fieldsToReset) {\n      field.obj.value = field.obj.defaultValue;\n      this._send({\n        id: field.obj._id,\n        siblings: field.obj._siblings,\n        value: field.obj.defaultValue,\n        formattedValue: null,\n        selRange: [0, 0]\n      });\n    }\n    if (mustCalculate) {\n      this.calculateNow();\n    }\n  }\n  saveAs() {}\n  scroll() {}\n  selectPageNthWord() {}\n  setAction() {}\n  setDataObjectContents() {}\n  setOCGOrder() {}\n  setPageAction() {}\n  setPageBoxes() {}\n  setPageLabels() {}\n  setPageRotations() {}\n  setPageTabOrder() {}\n  setPageTransitions() {}\n  spawnPageFromTemplate() {}\n  submitForm() {}\n  syncAnnotScan() {}\n}\n\n;// ./src/scripting_api/proxy.js\n\n\n\n\n\n\n\n\n\n\nclass ProxyHandler {\n  nosend = new Set(["delay"]);\n  get(obj, prop) {\n    if (prop in obj._expandos) {\n      const val = obj._expandos[prop];\n      if (typeof val === "function") {\n        return val.bind(obj);\n      }\n      return val;\n    }\n    if (typeof prop === "string" && !prop.startsWith("_") && prop in obj) {\n      const val = obj[prop];\n      if (typeof val === "function") {\n        return val.bind(obj);\n      }\n      return val;\n    }\n    return undefined;\n  }\n  set(obj, prop, value) {\n    if (obj._kidIds) {\n      obj._kidIds.forEach(id => {\n        obj._appObjects[id].wrapped[prop] = value;\n      });\n    }\n    if (typeof prop === "string" && !prop.startsWith("_") && prop in obj) {\n      const old = obj[prop];\n      obj[prop] = value;\n      if (!this.nosend.has(prop) && obj._send && obj._id !== null && typeof old !== "function") {\n        const data = {\n          id: obj._id\n        };\n        data[prop] = prop === "value" ? obj._getValue() : obj[prop];\n        if (!obj._siblings) {\n          obj._send(data);\n        } else {\n          data.siblings = obj._siblings;\n          obj._send(data);\n        }\n      }\n    } else {\n      obj._expandos[prop] = value;\n    }\n    return true;\n  }\n  has(obj, prop) {\n    return prop in obj._expandos || typeof prop === "string" && !prop.startsWith("_") && prop in obj;\n  }\n  getPrototypeOf(obj) {\n    return null;\n  }\n  setPrototypeOf(obj, proto) {\n    return false;\n  }\n  isExtensible(obj) {\n    return true;\n  }\n  preventExtensions(obj) {\n    return false;\n  }\n  getOwnPropertyDescriptor(obj, prop) {\n    if (prop in obj._expandos) {\n      return {\n        configurable: true,\n        enumerable: true,\n        value: obj._expandos[prop]\n      };\n    }\n    if (typeof prop === "string" && !prop.startsWith("_") && prop in obj) {\n      return {\n        configurable: true,\n        enumerable: true,\n        value: obj[prop]\n      };\n    }\n    return undefined;\n  }\n  defineProperty(obj, key, descriptor) {\n    Object.defineProperty(obj._expandos, key, descriptor);\n    return true;\n  }\n  deleteProperty(obj, prop) {\n    if (prop in obj._expandos) {\n      delete obj._expandos[prop];\n    }\n  }\n  ownKeys(obj) {\n    const fromExpandos = Reflect.ownKeys(obj._expandos);\n    const fromObj = Reflect.ownKeys(obj).filter(k => !k.startsWith("_"));\n    return fromExpandos.concat(fromObj);\n  }\n}\n\n;// ./src/scripting_api/util.js\n\n\n\n\n\n\n\nclass Util extends PDFObject {\n  #dateActionsCache = null;\n  constructor(data) {\n    super(data);\n    this._scandCache = new Map();\n    this._months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];\n    this._days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];\n    this.MILLISECONDS_IN_DAY = 86400000;\n    this.MILLISECONDS_IN_WEEK = 604800000;\n    this._externalCall = data.externalCall;\n  }\n  printf(...args) {\n    if (args.length === 0) {\n      throw new Error("Invalid number of params in printf");\n    }\n    if (typeof args[0] !== "string") {\n      throw new TypeError("First argument of printf must be a string");\n    }\n    const pattern = /%(,[0-4])?([+ 0#]+)?(\\d+)?(\\.\\d+)?(.)/g;\n    const PLUS = 1;\n    const SPACE = 2;\n    const ZERO = 4;\n    const HASH = 8;\n    let i = 0;\n    return args[0].replaceAll(pattern, function (match, nDecSep, cFlags, nWidth, nPrecision, cConvChar) {\n      if (cConvChar !== "d" && cConvChar !== "f" && cConvChar !== "s" && cConvChar !== "x") {\n        const buf = ["%"];\n        for (const str of [nDecSep, cFlags, nWidth, nPrecision, cConvChar]) {\n          if (str) {\n            buf.push(str);\n          }\n        }\n        return buf.join("");\n      }\n      i++;\n      if (i === args.length) {\n        throw new Error("Not enough arguments in printf");\n      }\n      const arg = args[i];\n      if (cConvChar === "s") {\n        return arg.toString();\n      }\n      let flags = 0;\n      if (cFlags) {\n        for (const flag of cFlags) {\n          switch (flag) {\n            case "+":\n              flags |= PLUS;\n              break;\n            case " ":\n              flags |= SPACE;\n              break;\n            case "0":\n              flags |= ZERO;\n              break;\n            case "#":\n              flags |= HASH;\n              break;\n          }\n        }\n      }\n      cFlags = flags;\n      if (nWidth) {\n        nWidth = parseInt(nWidth);\n      }\n      let intPart = Math.trunc(arg);\n      if (cConvChar === "x") {\n        let hex = Math.abs(intPart).toString(16).toUpperCase();\n        if (nWidth !== undefined) {\n          hex = hex.padStart(nWidth, cFlags & ZERO ? "0" : " ");\n        }\n        if (cFlags & HASH) {\n          hex = `0x${hex}`;\n        }\n        return hex;\n      }\n      if (nPrecision) {\n        nPrecision = parseInt(nPrecision.substring(1));\n      }\n      nDecSep = nDecSep ? nDecSep.substring(1) : "0";\n      const separators = {\n        0: [",", "."],\n        1: ["", "."],\n        2: [".", ","],\n        3: ["", ","],\n        4: ["\'", "."]\n      };\n      const [thousandSep, decimalSep] = separators[nDecSep];\n      let decPart = "";\n      if (cConvChar === "f") {\n        decPart = nPrecision !== undefined ? Math.abs(arg - intPart).toFixed(nPrecision) : Math.abs(arg - intPart).toString();\n        if (decPart.length > 2) {\n          if (/^1\\.0+$/.test(decPart)) {\n            intPart += Math.sign(arg);\n            decPart = `${decimalSep}${decPart.split(".")[1]}`;\n          } else {\n            decPart = `${decimalSep}${decPart.substring(2)}`;\n          }\n        } else {\n          if (decPart === "1") {\n            intPart += Math.sign(arg);\n          }\n          decPart = cFlags & HASH ? "." : "";\n        }\n      }\n      let sign = "";\n      if (intPart < 0) {\n        sign = "-";\n        intPart = -intPart;\n      } else if (cFlags & PLUS) {\n        sign = "+";\n      } else if (cFlags & SPACE) {\n        sign = " ";\n      }\n      if (thousandSep && intPart >= 1000) {\n        const buf = [];\n        while (true) {\n          buf.push((intPart % 1000).toString().padStart(3, "0"));\n          intPart = Math.trunc(intPart / 1000);\n          if (intPart < 1000) {\n            buf.push(intPart.toString());\n            break;\n          }\n        }\n        intPart = buf.reverse().join(thousandSep);\n      } else {\n        intPart = intPart.toString();\n      }\n      let n = `${intPart}${decPart}`;\n      if (nWidth !== undefined) {\n        n = n.padStart(nWidth - sign.length, cFlags & ZERO ? "0" : " ");\n      }\n      return `${sign}${n}`;\n    });\n  }\n  iconStreamFromIcon() {}\n  printd(cFormat, oDate) {\n    switch (cFormat) {\n      case 0:\n        return this.printd("D:yyyymmddHHMMss", oDate);\n      case 1:\n        return this.printd("yyyy.mm.dd HH:MM:ss", oDate);\n      case 2:\n        return this.printd("m/d/yy h:MM:ss tt", oDate);\n    }\n    const handlers = {\n      mmmm: data => this._months[data.month],\n      mmm: data => this._months[data.month].substring(0, 3),\n      mm: data => (data.month + 1).toString().padStart(2, "0"),\n      m: data => (data.month + 1).toString(),\n      dddd: data => this._days[data.dayOfWeek],\n      ddd: data => this._days[data.dayOfWeek].substring(0, 3),\n      dd: data => data.day.toString().padStart(2, "0"),\n      d: data => data.day.toString(),\n      yyyy: data => data.year.toString().padStart(4, "0"),\n      yy: data => (data.year % 100).toString().padStart(2, "0"),\n      HH: data => data.hours.toString().padStart(2, "0"),\n      H: data => data.hours.toString(),\n      hh: data => (1 + (data.hours + 11) % 12).toString().padStart(2, "0"),\n      h: data => (1 + (data.hours + 11) % 12).toString(),\n      MM: data => data.minutes.toString().padStart(2, "0"),\n      M: data => data.minutes.toString(),\n      ss: data => data.seconds.toString().padStart(2, "0"),\n      s: data => data.seconds.toString(),\n      tt: data => data.hours < 12 ? "am" : "pm",\n      t: data => data.hours < 12 ? "a" : "p"\n    };\n    const data = {\n      year: oDate.getFullYear(),\n      month: oDate.getMonth(),\n      day: oDate.getDate(),\n      dayOfWeek: oDate.getDay(),\n      hours: oDate.getHours(),\n      minutes: oDate.getMinutes(),\n      seconds: oDate.getSeconds()\n    };\n    const patterns = /(mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|HH|H|hh|h|MM|M|ss|s|tt|t|\\\\.)/g;\n    return cFormat.replaceAll(patterns, function (match, pattern) {\n      if (pattern in handlers) {\n        return handlers[pattern](data);\n      }\n      return pattern.charCodeAt(1);\n    });\n  }\n  printx(cFormat, cSource) {\n    cSource = (cSource ?? "").toString();\n    const handlers = [x => x, x => x.toUpperCase(), x => x.toLowerCase()];\n    const buf = [];\n    let i = 0;\n    const ii = cSource.length;\n    let currCase = handlers[0];\n    let escaped = false;\n    for (const command of cFormat) {\n      if (escaped) {\n        buf.push(command);\n        escaped = false;\n        continue;\n      }\n      if (i >= ii) {\n        break;\n      }\n      switch (command) {\n        case "?":\n          buf.push(currCase(cSource.charAt(i++)));\n          break;\n        case "X":\n          while (i < ii) {\n            const char = cSource.charAt(i++);\n            if ("a" <= char && char <= "z" || "A" <= char && char <= "Z" || "0" <= char && char <= "9") {\n              buf.push(currCase(char));\n              break;\n            }\n          }\n          break;\n        case "A":\n          while (i < ii) {\n            const char = cSource.charAt(i++);\n            if ("a" <= char && char <= "z" || "A" <= char && char <= "Z") {\n              buf.push(currCase(char));\n              break;\n            }\n          }\n          break;\n        case "9":\n          while (i < ii) {\n            const char = cSource.charAt(i++);\n            if ("0" <= char && char <= "9") {\n              buf.push(char);\n              break;\n            }\n          }\n          break;\n        case "*":\n          while (i < ii) {\n            buf.push(currCase(cSource.charAt(i++)));\n          }\n          break;\n        case "\\\\":\n          escaped = true;\n          break;\n        case ">":\n          currCase = handlers[1];\n          break;\n        case "<":\n          currCase = handlers[2];\n          break;\n        case "=":\n          currCase = handlers[0];\n          break;\n        default:\n          buf.push(command);\n      }\n    }\n    return buf.join("");\n  }\n  #tryToGuessDate(cFormat, cDate) {\n    let actions = (this.#dateActionsCache ||= new Map()).get(cFormat);\n    if (!actions) {\n      actions = [];\n      this.#dateActionsCache.set(cFormat, actions);\n      cFormat.replaceAll(/(d+)|(m+)|(y+)|(H+)|(M+)|(s+)/g, function (_match, d, m, y, H, M, s) {\n        if (d) {\n          actions.push((n, data) => {\n            if (n >= 1 && n <= 31) {\n              data.day = n;\n              return true;\n            }\n            return false;\n          });\n        } else if (m) {\n          actions.push((n, data) => {\n            if (n >= 1 && n <= 12) {\n              data.month = n - 1;\n              return true;\n            }\n            return false;\n          });\n        } else if (y) {\n          actions.push((n, data) => {\n            if (n < 50) {\n              n += 2000;\n            } else if (n < 100) {\n              n += 1900;\n            }\n            data.year = n;\n            return true;\n          });\n        } else if (H) {\n          actions.push((n, data) => {\n            if (n >= 0 && n <= 23) {\n              data.hours = n;\n              return true;\n            }\n            return false;\n          });\n        } else if (M) {\n          actions.push((n, data) => {\n            if (n >= 0 && n <= 59) {\n              data.minutes = n;\n              return true;\n            }\n            return false;\n          });\n        } else if (s) {\n          actions.push((n, data) => {\n            if (n >= 0 && n <= 59) {\n              data.seconds = n;\n              return true;\n            }\n            return false;\n          });\n        }\n        return "";\n      });\n    }\n    const number = /\\d+/g;\n    let i = 0;\n    let array;\n    const data = {\n      year: new Date().getFullYear(),\n      month: 0,\n      day: 1,\n      hours: 12,\n      minutes: 0,\n      seconds: 0\n    };\n    while ((array = number.exec(cDate)) !== null) {\n      if (i < actions.length) {\n        if (!actions[i++](parseInt(array[0]), data)) {\n          return null;\n        }\n      } else {\n        break;\n      }\n    }\n    if (i === 0) {\n      return null;\n    }\n    return new Date(data.year, data.month, data.day, data.hours, data.minutes, data.seconds);\n  }\n  scand(cFormat, cDate) {\n    return this._scand(cFormat, cDate);\n  }\n  _scand(cFormat, cDate, strict = false) {\n    if (typeof cDate !== "string") {\n      return new Date(cDate);\n    }\n    if (cDate === "") {\n      return new Date();\n    }\n    switch (cFormat) {\n      case 0:\n        return this.scand("D:yyyymmddHHMMss", cDate);\n      case 1:\n        return this.scand("yyyy.mm.dd HH:MM:ss", cDate);\n      case 2:\n        return this.scand("m/d/yy h:MM:ss tt", cDate);\n    }\n    if (!this._scandCache.has(cFormat)) {\n      const months = this._months;\n      const days = this._days;\n      const handlers = {\n        mmmm: {\n          pattern: `(${months.join("|")})`,\n          action: (value, data) => {\n            data.month = months.indexOf(value);\n          }\n        },\n        mmm: {\n          pattern: `(${months.map(month => month.substring(0, 3)).join("|")})`,\n          action: (value, data) => {\n            data.month = months.findIndex(month => month.substring(0, 3) === value);\n          }\n        },\n        mm: {\n          pattern: `(\\\\d{2})`,\n          action: (value, data) => {\n            data.month = parseInt(value) - 1;\n          }\n        },\n        m: {\n          pattern: `(\\\\d{1,2})`,\n          action: (value, data) => {\n            data.month = parseInt(value) - 1;\n          }\n        },\n        dddd: {\n          pattern: `(${days.join("|")})`,\n          action: (value, data) => {\n            data.day = days.indexOf(value);\n          }\n        },\n        ddd: {\n          pattern: `(${days.map(day => day.substring(0, 3)).join("|")})`,\n          action: (value, data) => {\n            data.day = days.findIndex(day => day.substring(0, 3) === value);\n          }\n        },\n        dd: {\n          pattern: "(\\\\d{2})",\n          action: (value, data) => {\n            data.day = parseInt(value);\n          }\n        },\n        d: {\n          pattern: "(\\\\d{1,2})",\n          action: (value, data) => {\n            data.day = parseInt(value);\n          }\n        },\n        yyyy: {\n          pattern: "(\\\\d{4})",\n          action: (value, data) => {\n            data.year = parseInt(value);\n          }\n        },\n        yy: {\n          pattern: "(\\\\d{2})",\n          action: (value, data) => {\n            data.year = 2000 + parseInt(value);\n          }\n        },\n        HH: {\n          pattern: "(\\\\d{2})",\n          action: (value, data) => {\n            data.hours = parseInt(value);\n          }\n        },\n        H: {\n          pattern: "(\\\\d{1,2})",\n          action: (value, data) => {\n            data.hours = parseInt(value);\n          }\n        },\n        hh: {\n          pattern: "(\\\\d{2})",\n          action: (value, data) => {\n            data.hours = parseInt(value);\n          }\n        },\n        h: {\n          pattern: "(\\\\d{1,2})",\n          action: (value, data) => {\n            data.hours = parseInt(value);\n          }\n        },\n        MM: {\n          pattern: "(\\\\d{2})",\n          action: (value, data) => {\n            data.minutes = parseInt(value);\n          }\n        },\n        M: {\n          pattern: "(\\\\d{1,2})",\n          action: (value, data) => {\n            data.minutes = parseInt(value);\n          }\n        },\n        ss: {\n          pattern: "(\\\\d{2})",\n          action: (value, data) => {\n            data.seconds = parseInt(value);\n          }\n        },\n        s: {\n          pattern: "(\\\\d{1,2})",\n          action: (value, data) => {\n            data.seconds = parseInt(value);\n          }\n        },\n        tt: {\n          pattern: "([aApP][mM])",\n          action: (value, data) => {\n            const char = value.charAt(0);\n            data.am = char === "a" || char === "A";\n          }\n        },\n        t: {\n          pattern: "([aApP])",\n          action: (value, data) => {\n            data.am = value === "a" || value === "A";\n          }\n        }\n      };\n      const escapedFormat = cFormat.replaceAll(/[.*+\\-?^${}()|[\\]\\\\]/g, "\\\\$&");\n      const patterns = /(mmmm|mmm|mm|m|dddd|ddd|dd|d|yyyy|yy|HH|H|hh|h|MM|M|ss|s|tt|t)/g;\n      const actions = [];\n      const re = escapedFormat.replaceAll(patterns, function (match, patternElement) {\n        const {\n          pattern,\n          action\n        } = handlers[patternElement];\n        actions.push(action);\n        return pattern;\n      });\n      this._scandCache.set(cFormat, [re, actions]);\n    }\n    const [re, actions] = this._scandCache.get(cFormat);\n    const matches = new RegExp(`^${re}$`, "g").exec(cDate);\n    if (!matches || matches.length !== actions.length + 1) {\n      return strict ? null : this.#tryToGuessDate(cFormat, cDate);\n    }\n    const data = {\n      year: 2000,\n      month: 0,\n      day: 1,\n      hours: 0,\n      minutes: 0,\n      seconds: 0,\n      am: null\n    };\n    actions.forEach((action, i) => action(matches[i + 1], data));\n    if (data.am !== null) {\n      data.hours = data.hours % 12 + (data.am ? 0 : 12);\n    }\n    return new Date(data.year, data.month, data.day, data.hours, data.minutes, data.seconds);\n  }\n  spansToXML() {}\n  stringFromStream() {}\n  xmlToSpans() {}\n}\n\n;// ./src/scripting_api/initialization.js\n\n\n\n\n\n\n\n\n\n\n\n\n\nfunction initSandbox(params) {\n  delete globalThis.pdfjsScripting;\n  const externalCall = globalThis.callExternalFunction;\n  delete globalThis.callExternalFunction;\n  const globalEval = code => globalThis.eval(code);\n  const send = data => externalCall("send", [data]);\n  const proxyHandler = new ProxyHandler();\n  const {\n    data\n  } = params;\n  const doc = new Doc({\n    send,\n    globalEval,\n    ...data.docInfo\n  });\n  const _document = {\n    obj: doc,\n    wrapped: new Proxy(doc, proxyHandler)\n  };\n  const app = new App({\n    send,\n    globalEval,\n    externalCall,\n    _document,\n    calculationOrder: data.calculationOrder,\n    proxyHandler,\n    ...data.appInfo\n  });\n  const util = new Util({\n    externalCall\n  });\n  const appObjects = app._objects;\n  if (data.objects) {\n    const annotations = [];\n    for (const [name, objs] of Object.entries(data.objects)) {\n      annotations.length = 0;\n      let container = null;\n      for (const obj of objs) {\n        if (obj.type !== "") {\n          annotations.push(obj);\n        } else {\n          container = obj;\n        }\n      }\n      let obj = container;\n      if (annotations.length > 0) {\n        obj = annotations[0];\n        obj.send = send;\n      }\n      obj.globalEval = globalEval;\n      obj.doc = _document;\n      obj.fieldPath = name;\n      obj.appObjects = appObjects;\n      obj.util = util;\n      const otherFields = annotations.slice(1);\n      let field;\n      switch (obj.type) {\n        case "radiobutton":\n          {\n            field = new RadioButtonField(otherFields, obj);\n            break;\n          }\n        case "checkbox":\n          {\n            field = new CheckboxField(otherFields, obj);\n            break;\n          }\n        default:\n          if (otherFields.length > 0) {\n            obj.siblings = otherFields.map(x => x.id);\n          }\n          field = new Field(obj);\n      }\n      const wrapped = new Proxy(field, proxyHandler);\n      const _object = {\n        obj: field,\n        wrapped\n      };\n      doc._addField(name, _object);\n      for (const object of objs) {\n        appObjects[object.id] = _object;\n      }\n      if (container) {\n        appObjects[container.id] = _object;\n      }\n    }\n  }\n  const color = new Color();\n  globalThis.event = null;\n  globalThis.global = Object.create(null);\n  globalThis.app = new Proxy(app, proxyHandler);\n  globalThis.color = new Proxy(color, proxyHandler);\n  globalThis.console = new Proxy(new Console({\n    send\n  }), proxyHandler);\n  globalThis.util = new Proxy(util, proxyHandler);\n  globalThis.border = Border;\n  globalThis.cursor = Cursor;\n  globalThis.display = Display;\n  globalThis.font = Font;\n  globalThis.highlight = Highlight;\n  globalThis.position = Position;\n  globalThis.scaleHow = ScaleHow;\n  globalThis.scaleWhen = ScaleWhen;\n  globalThis.style = Style;\n  globalThis.trans = Trans;\n  globalThis.zoomtype = ZoomType;\n  globalThis.ADBE = {\n    Reader_Value_Asked: true,\n    Viewer_Value_Asked: true\n  };\n  const aform = new AForm(doc, app, util, color);\n  for (const name of Object.getOwnPropertyNames(AForm.prototype)) {\n    if (name !== "constructor" && !name.startsWith("_")) {\n      globalThis[name] = aform[name].bind(aform);\n    }\n  }\n  for (const [name, value] of Object.entries(GlobalConstants)) {\n    Object.defineProperty(globalThis, name, {\n      value,\n      writable: false\n    });\n  }\n  Object.defineProperties(globalThis, {\n    ColorConvert: {\n      value: color.convert.bind(color),\n      writable: true\n    },\n    ColorEqual: {\n      value: color.equal.bind(color),\n      writable: true\n    }\n  });\n  const properties = Object.create(null);\n  for (const name of Object.getOwnPropertyNames(Doc.prototype)) {\n    if (name === "constructor" || name.startsWith("_")) {\n      continue;\n    }\n    const descriptor = Object.getOwnPropertyDescriptor(Doc.prototype, name);\n    if (descriptor.get) {\n      properties[name] = {\n        get: descriptor.get.bind(doc),\n        set: descriptor.set.bind(doc)\n      };\n    } else {\n      properties[name] = {\n        value: Doc.prototype[name].bind(doc)\n      };\n    }\n  }\n  Object.defineProperties(globalThis, properties);\n  const functions = {\n    dispatchEvent: app._dispatchEvent.bind(app),\n    timeoutCb: app._evalCallback.bind(app)\n  };\n  return (name, args) => {\n    try {\n      functions[name](args);\n    } catch (error) {\n      send(serializeError(error));\n    }\n  };\n}\n\n;// ./src/pdf.scripting.js\n\nglobalThis.pdfjsScripting = {\n  initSandbox: initSandbox\n};\n' ];
        code.push("delete dump;");
        let success = false;
        let buf = 0;
        try {
            const sandboxData = JSON.stringify(data);
            code.push(`pdfjsScripting.initSandbox({ data: ${sandboxData} })`);
            buf = this._module.stringToNewUTF8(code.join("\n"));
            success = !!this._module.ccall("init", "number", [ "number", "number" ], [ buf, this._alertOnError ]);
        } catch (error) {
            console.error(error);
        } finally {
            if (buf) {
                this._module.ccall("free", "number", [ "number" ], [ buf ]);
            }
        }
        if (success) {
            this.support.commFun = this._module.cwrap("commFun", null, [ "string", "string" ]);
        } else {
            this.nukeSandbox();
            throw new Error("Cannot start sandbox");
        }
    }
    dispatchEvent(event) {
        this.support?.callSandboxFunction("dispatchEvent", event);
    }
    dumpMemoryUse() {
        this._module?.ccall("dumpMemoryUse", null, []);
    }
    nukeSandbox() {
        if (this._module !== null) {
            this.support.destroy();
            this.support = null;
            this._module.ccall("nukeSandbox", null, []);
            this._module = null;
        }
    }
    evalForTesting(code, key) {
        throw new Error("Not implemented: evalForTesting");
    }
}

async function QuickJSSandbox(wasmUrl = "../web/wasm/") {
    const {default: ModuleLoader} = await import(`${wasmUrl}quickjs-eval.js`);
    const module = await ModuleLoader();
    return new Sandbox(window, module);
}

globalThis.pdfjsSandbox = {
    QuickJSSandbox: QuickJSSandbox
};

export { QuickJSSandbox };