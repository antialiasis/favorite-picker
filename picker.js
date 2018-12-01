'use strict';

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.picker = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    /* POLYFILLS */

    if (!Array.isArray) {
      Array.isArray = function(arg) {
        return Object.prototype.toString.call(arg) === '[object Array]';
      };
    }

    /* PICKER STATE OBJECT */

    function PickerState(options) {
        if (!options.items) {
            console.error("No items specified for PickerState!");
            return;
        }
        this.options = copyObject(options);
    };

    /* INITIALIZATION AND SERIALIZATION */

    PickerState.prototype.getState = function() {
        /**
         * Returns a state object corresponding to this PickerState.
         * We're using deep copies because otherwise the eliminatedBy arrays
         * may get mutated and undoing/redoing can corrupt the state.
         */
        return {
            eliminated: copyArray(this.arrays.eliminated),
            survived: copyArray(this.arrays.survived),
            current: copyArray(this.arrays.current),
            evaluating: copyArray(this.arrays.evaluating),
            favorites: copyArray(this.arrays.favorites),
            settings: copyObject(this.settings)
        };
    };

    PickerState.prototype.initialize = function(settings) {
        /**
         * Initializes the PickerState according to the given settings
         * (or the default settings if no settings are provided).
         */
        this.settings = settings || this.options.defaultSettings || {};
        this.items = this.getFilteredItems();

        this.arrays = {
            eliminated: [],
            survived: [],
            current: this.items.slice(0),
            evaluating: [],
            favorites: []
        };
        this.batchSize = this.getBatchSize(this.arrays.current.length);

        shuffle(this.arrays.current);

        this.nextBatch();
    };

    PickerState.prototype.restoreState = function(state) {
        /**
         * Sets the PickerState to the given dehydrated state.
         */
        this.settings = copyObject(this.options.defaultSettings || {}, state.settings || {});

        this.items = this.getFilteredItems();

        this.arrays = {
            eliminated: copyArray(state.eliminated),
            survived: copyArray(state.survived),
            current: copyArray(state.current),
            evaluating: copyArray(state.evaluating),
            favorites: copyArray(state.favorites)
        };
        this.batchSize = this.arrays.evaluating.length;

        this.validate();
    };

    PickerState.prototype.reset = function() {
        /**
         * Resets the PickerState to its initial state (leaving the settings
         * unchanged).
         */
        this.initialize(this.settings);
    };

    /* PUBLIC SETTERS */

    PickerState.prototype.setSettings = function(settings) {
        /**
         * Sets the settings.
         */
        this.settings = settings;
        this.items = this.getFilteredItems();

        this.validate();
        this.resetBatchSize();
    };

    PickerState.prototype.setFavorites = function(favorites) {
        /**
         * Overwrites the found favorites list with the given one.
         * Since it runs validate, it should be fine if this changes the
         * actual contents of the list.
         */
        this.arrays.favorites = favorites;
        this.validate();
    };

    /* STATE UTILITY FUNCTIONS */

    PickerState.prototype.findByIdentifier = function(identifier, array) {
        /**
         * Searches for the given item identifier in the given array and
         * returns the index at which that identifier is found (or -1 if it is
         * not found). Handles both plain arrays of identifiers and arrays of
         * objects with an id property (e.g. the eliminated array).
         */
        for (var i = 0; i < array.length; i++) {
            if (array[i] === identifier || array[i].id === identifier) {
                return i;
            }
        }
        return -1;
    };

    PickerState.prototype.shouldIncludeItem = function(identifier, settings) {
        /**
         * Returns true if this item should be included in the picker
         * according to the current settings.
         */
        if (this.options.getFilteredItems) {
            return this.options.getFilteredItems(settings).indexOf(identifier) !== -1;
        }
        else if (this.options.shouldIncludeItem) {
            return this.options.shouldIncludeItem(identifier, settings);
        }
        return true;
    };

    PickerState.prototype.getFilteredItems = function() {
        /**
         * Returns a list of item identifiers that match the given
         * settings.
         */
        if (this.options.getFilteredItems) {
            return this.options.getFilteredItems(this.settings);
        }
        var result = [];
        var i;
        for (i = 0; i < this.options.items.length; i++) {
            if (this.shouldIncludeItem(this.options.items[i], this.settings)) {
                result.push(this.options.items[i]);
            }
        }
        return result;
    };

    PickerState.prototype.findInArray = function(identifier, arrayName) {
        /**
         * If the given identifier is found in the given array of the state,
         * return that entry. Otherwise, return null.
         */
        var index = this.findByIdentifier(identifier, this.arrays[arrayName]);
        if (index !== -1) {
            return this.arrays[arrayName][index];
        }
        else {
            return null;
        }
    };

    PickerState.prototype.getBatchSize = function(currentSize) {
        /**
         * Returns the number of items that should ideally be displayed at a
         * time, given the whole round is currentSize items.
         */
        if (this.options.getBatchSize) {
            return this.options.getBatchSize(currentSize, this.settings);
        }
        return Math.max(2, this.settings.minBatchSize || 2, Math.min(this.settings.maxBatchSize || 20, Math.ceil(currentSize / 5)));
    };

    PickerState.prototype.resetBatchSize = function() {
        /**
         * Resets the current batch size to whatever it ought to be given the
         * size of the current and survived arrays and adjusts the evaluating
         * array accordingly.
         */
        Array.prototype.unshift.apply(this.arrays.current, this.arrays.evaluating);
        this.arrays.evaluating = this.arrays.current.splice(0, this.getBatchSize(this.arrays.current.length + this.arrays.survived.length));
        this.batchSize = this.arrays.evaluating.length;
    };

    /* STATE VALIDATION */

    PickerState.prototype.validate = function () {
        /**
         * Validates and corrects the state.
         */
        var expectedItems = this.getFilteredItems();

        var missingItems = [];
        var extraItems = [];
        var survived = this.arrays.survived;
        var eliminated = this.arrays.eliminated;
        var evaluating = this.arrays.evaluating;
        var current = this.arrays.current;
        var favorites = this.arrays.favorites;
        var arrays = [favorites, survived, eliminated, current, evaluating];
        var identifier;

        var verifyObject = {};
        var i, j;

        for (i = 0; i < expectedItems.length; i++) {
            verifyObject[expectedItems[i]] = false;
        }

        // Go through all the items in each array and:
        // - correct errors
        // - mark off the item in the verify object
        // - make sure that each item appears only once by checking if it's
        //   previously been marked off
        // - remove any extra items that shouldn't be there
        // We do this backwards so that we can remove items with splice
        // without messing up the parts of the array we haven't gone through
        // yet.
        for (i = 0; i < arrays.length; i++) {
            for (j = arrays[i].length - 1; j >= 0; j--) {
                identifier = arrays[i][j].id || arrays[i][j];
                if (identifier in verifyObject) {
                    // This is one of the items we expect
                    if (verifyObject[identifier]) {
                        // We've already found this item - it's a copy.
                        // Remove it from this array and restore any items
                        // eliminated by it, since it might be in error.
                        arrays[i].splice(j, 1);
                        this.removeFromEliminated(identifier);
                    }
                    verifyObject[identifier] = true;
                }
                else {
                    // This is an unexpected item - we want to remove it
                    arrays[i].splice(j, 1);
                    extraItems.push(identifier);
                }
            }
        }
        // Ensure no item is eliminated by itself, fix eliminated items not
        // being properly ntroduced after their eliminator is found, plus
        // removing extraneous items from eliminated lists.
        // We go through both arrays backwards so that splicing the indices
        // won't mess up subsequent indices.
        for (i = eliminated.length - 1; i >= 0; i--) {
            for (j = eliminated[i].eliminatedBy.length - 1; j >= 0; j--) {
                if (eliminated[i].id === eliminated[i].eliminatedBy[j]) {
                    this.removeEliminatedBy(i, j);
                }
                if (favorites.indexOf(eliminated[i].eliminatedBy[j]) !== -1 || extraItems.indexOf(eliminated[i].eliminatedBy[j]) !== -1) {
                    this.removeEliminatedBy(i, j);
                }
            }
        }

        // Add in any items that we ought to have but weren't in any of the
        // arrays
        for (identifier in verifyObject) {
            if (verifyObject[identifier] === false) {
                missingItems.push(identifier);
                current.push(identifier);
            }
        }

        // Store the missing items that we've added, if we want to alert the
        // user about them later
        if (missingItems.length > 0) {
            this.missingItems = missingItems;
            // Shuffle current: if we've just added some items, we don't want
            // them all to be dumped at the end of the round
            shuffle(current);
        }

        if (current.length === 0 && evaluating.length === 0 && survived.length > 0) {
            this.nextRound();
            return;
        }

        if (evaluating.length < 2) {
            // Give us an evaluation batch of the size that it should be.
            this.resetBatchSize();
        }
        else {
            this.batchSize = evaluating.length;
        }
    };

    /* MAIN PICKER LOGIC */

    PickerState.prototype.pick = function(picked) {
        /**
         * Picks the given items from the current evaluating batch, moving
         * them into the survived array and the others into the eliminated
         * array.
         */
        var i;
        var evaluating = this.arrays.evaluating;
        var survived = this.arrays.survived;
        var eliminated = this.arrays.eliminated;

        // Loop through the items we're currently evaluating
        for (i = 0; i < evaluating.length; i++) {
            if (!picked.length || this.findByIdentifier(evaluating[i], picked) !== -1) {
                // This item is one of the ones we picked - add it to
                // survived
                survived.push(evaluating[i]);
            }
            else {
                // This item is not one of the ones we picked - add it to
                // eliminated, with the picked items as the eliminators
                eliminated.push({id: evaluating[i], eliminatedBy: picked.slice(0)});
            }
        }
        this.arrays.evaluating = [];
        this.nextBatch();
    };

    PickerState.prototype.pass = function() {
        /**
         * Passes on this batch of items, equivalent to picking every
         * item.
         */
        this.pick(this.arrays.evaluating);
    };

    PickerState.prototype.removeEliminatedBy = function(i, j) {
        /**
         * Removes the jth item from the eliminatedBy array of the ith
         * item in the eliminated array, restoring the item to the
         * survived array if this leaves the eliminatedBy list empty.
         *
         * This modifies the arrays in-place; if executed inside a loop,
         * the loop must run backwards through both arrays.
         */
        var eliminated = this.arrays.eliminated;

        eliminated[i].eliminatedBy.splice(j, 1);
        if (eliminated[i].eliminatedBy.length === 0) {
            this.arrays.survived.push(eliminated.splice(i, 1)[0].id);
        }
    };

    PickerState.prototype.removeFromEliminated = function(item) {
        /**
         * Remove this item from all eliminatedBy lists, restoring any
         * items left with empty eliminatedBy lists to the survived array.
         */
        var i, idx;
        var eliminated = this.arrays.eliminated;

        // Find items that were eliminated by this item.
        for (i = eliminated.length - 1; i >= 0; i--) {
            idx = this.findByIdentifier(item, eliminated[i].eliminatedBy);
            if (idx !== -1) {
                // This item was (partly) eliminated by the given item;
                // remove it
                this.removeEliminatedBy(i, idx);
            }
        }
    };

    PickerState.prototype.addToFavorites = function(item) {
        /**
         * Add the given item (identifier) to favorites and restore
         * the items eliminated by it to survived.
         */
        this.arrays.favorites.push(item);
        this.removeFromEliminated(item);
    };

    PickerState.prototype.nextBatch = function() {
        /**
         * Moves on to the next batch of items, adding to favorites if appropriate.
         */
        var current = this.arrays.current;

        if (current.length < this.batchSize && this.arrays.survived.length > 0) {
            // Start the next round
            this.nextRound();
            return;
        }
        this.arrays.evaluating = current.splice(0, this.batchSize);
    };

    PickerState.prototype.nextRound = function() {
        /**
         * Moves on to the next round, shuffling the survived array back into
         * the current array.
         */
        // If we've only got one item left in survived, then it's our next
        // favorite - add it to favorites and then start the next round with
        // the new survivors.
        if (this.arrays.current.length === 0 && this.arrays.survived.length === 1) {
            this.addToFavorites(this.arrays.survived.pop());
            this.nextRound();
            return;
        }
        shuffle(this.arrays.survived);
        // Take the survivors and put them at the end of the current array.
        this.arrays.current = this.arrays.current.concat(this.arrays.survived.splice(0, this.arrays.survived.length));
        // Pick an appropriate batch size for this new round and then show the next batch.
        this.batchSize = this.getBatchSize(this.arrays.current.length);
        this.nextBatch();
    };

    /* PICKER OBJECT */

    function Picker(options) {
        if (!(this instanceof Picker)) {
            return new Picker(options);
        }

        if (!options.items) {
            console.error("No items specified for picker.");
            return;
        }

        var self = this;

        this.itemMap = {};
        this.options = copyObject({
            historyLength: 3,
            favoritesQueryParam: 'favs'
        }, options);

        this.history = [];
        this.historyPos = -1;

        var i;

        // Build the itemMap and catch errors
        for (i = 0; i < options.items.length; i++) {
            if (options.items[i].id === undefined) {
                console.error("You have an item without an ID! An ID is necessary for the picker's functionality to work.", options.items[i]);
                return;
            }
            if (this.itemMap.hasOwnProperty(options.items[i].id)) {
                console.error("You have more than one item with the same ID (" + options.items[i].id + ")! Please ensure the IDs of your items are unique.");
                return;
            }
            if (options.shortcodeLength && (!options.items[i].shortcode || options.items[i].shortcode.length !== options.shortcodeLength)) {
                console.error("You have defined a shortcode length of " + options.shortcodeLength + "; however, you have an item with a shortcode that does not match this length (" + options.items[i].shortcode + "). The shortcode functionality only works if the item shortcodes are of a consistent length.", options.items[i]);
                return;
            } 
            this.itemMap[options.items[i].id] = options.items[i];
        }

        var defaultSettings = options.defaultSettings || {};


        /* PICKER INITIALIZATION */

        var pickerStateOptions = {
            items: map(options.items, function (item) {
                return item.id;
            }),
            getBatchSize: options.getBatchSize,
            shouldIncludeItem: options.shouldIncludeItem && function (identifier, settings) {
                return options.shouldIncludeItem(self.itemMap[identifier], settings)
            },
            getFilteredItems: options.getFilteredItems,
            defaultSettings: defaultSettings
        };

        var savedState = this.loadState();

        // Modify the savedState if we have a modifyState function...
        if (savedState && options.modifyState) {
            savedState = options.modifyState(savedState);
        }
        // ...but if the end result isn't a valid state, throw it away
        if (savedState && !isState(savedState)) {
            console.warn("Ignoring invalid saved state");
            savedState = null;
        }

        this.state = new PickerState(pickerStateOptions);

        if (savedState) {
            this.state.restoreState(savedState, defaultSettings);
            if (options.onLoadState) {
                options.onLoadState.call(
                    this,
                    this.state.missingItems || [],
                    this.state.extraItems || []
                );
            }
            this.pushHistory();
        }
        else {
            this.state.initialize(defaultSettings);
            this.pushHistory();
        }
    }

    /* GETTERS */

    Picker.prototype.getArray = function(arrayName) {
        /**
         * Gets the full list of items in the given array.
         */
        return this.mapItems(this.state.arrays[arrayName]);
    };

    Picker.prototype.getFavorites = function() {
        /**
         * Gets the current favorite list.
         */
        return this.getArray('favorites');
    };

    Picker.prototype.getEvaluating = function() {
        /**
         * Gets the current evaluating list.
         */
        return this.getArray('evaluating');
    };

    Picker.prototype.getSettings = function() {
        /**
         * Gets the state's current settings.
         */
        return this.state.settings;
    };

    Picker.prototype.getSharedFavorites = function() {
        /**
         * Gets the shared favorite list.
         */
        var query;

        if (window.location.search && this.options.favoritesQueryParam && this.options.shortcodeLength) {
            query = parseQueryString(window.location.search.substring(1));
            return this.mapItems(this.parseShortcodeString(query[this.options.favoritesQueryParam]) || []);
        }
        return null;
    };

    /* SHORTCODES */

    Picker.prototype.getShortcodeString = function() {
        /**
         * Gets a shortcode string for the current favorite list.
         */
        return map(this.getFavorites(), function(item) {
            return item.shortcode;
        }).join('');
    };

    Picker.prototype.getShortcodeLink = function() {
        /**
         * Gets a shortcode link for the current favorite list.
         */
        return '?' + this.options.favoritesQueryParam + '=' + this.getShortcodeString();
    };

    Picker.prototype.parseShortcodeString = function(shortcodeString) {
        /**
         * Returns the list of favorites given by a shortcode string.
         */
        var self = this;
        var favorites = [];
        var i;
        var shortcode;
        var shortcodeMap = {};
        var favoriteMap = {};

        this.forEachItem(function (identifier) {
            shortcodeMap[self.itemMap[identifier].shortcode] = identifier;
        });

        for (i = 0; i < shortcodeString.length; i += this.options.shortcodeLength) {
            shortcode = shortcodeString.substring(i, i + this.options.shortcodeLength);
            if (shortcode in shortcodeMap) {
                if (!favoriteMap[shortcodeMap[shortcode]]) {
                    favorites.push(shortcodeMap[shortcode]);
                    favoriteMap[shortcodeMap[shortcode]] = true;
                }
            }
        }
        return favorites;
    };

    /* HISTORY */

    Picker.prototype.pushHistory = function() {
        /**
         * Adds the current state to the history array.
         */
        this.history.splice(this.historyPos + 1, this.history.length, this.state.getState());
        if (this.history.length > this.options.historyLength + 1) {
            this.history.shift();
        }
        this.historyPos = this.history.length - 1;
        this.saveState();
    };

    Picker.prototype.canUndo = function() {
        /**
         * Returns true if we can undo.
         */
        return this.historyPos > 0;
    };

    Picker.prototype.canRedo = function() {
        /**
         * Returns true if we can redo.
         */
        return this.historyPos < this.history.length - 1;
    };

    Picker.prototype.undo = function() {
        /**
         * Reverts to the previous state in the history array.
         */
        if (!this.canUndo()) {
            return;
        }
        this.state.restoreState(this.history[--this.historyPos]);
        this.saveState();
    };

    Picker.prototype.redo = function() {
        /**
         * Proceeds to the next state in the history array.
         */
        if (!this.canRedo()) {
            return;
        }
        this.state.restoreState(this.history[++this.historyPos]);
        this.saveState();
    };

    Picker.prototype.resetToFavorites = function (favorites, useSettings) {
        /**
         * Creates a clean state with the items given in favorites (as
         * identifiers) as found favorites.
         *
         * If useSettings is given, then those will be the settings used and
         * any favorites that don't fit the parameters will be discarded.
         * Otherwise, the settings will be set by the settingsFromFavorites
         * option, or set to the default otherwise.
         */
        var finalFavorites = [];
        var i;

        for (i = 0; i < favorites.length; i ++) {
            // Only add the item if it matches the settings (or if we don't have any given settings)
            if (!useSettings || this.state.shouldIncludeItem(favorites[i], useSettings)) {
                finalFavorites.push(favorites[i]);
            }
        }

        if (!useSettings) {
            // If we don't have any given settings, then set the settings according to the favorites instead
            if (this.options.settingsFromFavorites) {
                useSettings = copyObject(this.options.defaultSettings, this.options.settingsFromFavorites(this.mapItems(favorites)));
            }
            else {
                useSettings = copyObject(this.options.defaultSettings);
            }
        }

        // This should set the entire state properly.
        this.state.initialize(useSettings);
        this.state.setFavorites(finalFavorites);
        this.initialFavorites = finalFavorites;
        this.pushHistory();
    };

    /* STATE */

    Picker.prototype.saveState = function() {
        /**
         * Saves the given state in localStorage, assuming it is available.
         */
        if (this.options.saveState) {
            this.options.saveState.call(this, this.state.getState());
        }
        else if (localStorage && JSON && this.options.localStorageKey) {
            localStorage.setItem(this.options.localStorageKey, JSON.stringify(this.state.getState()));
        }
    };

    Picker.prototype.loadState = function() {
        /**
         * Returns the state stored in localStorage, if there is one.
         */
        var state;
        if (this.options.loadState) {
            state = this.options.loadState.call(this);
        }
        else if (localStorage && JSON && this.options.localStorageKey) {
            try {
                state = JSON.parse(localStorage.getItem(this.options.localStorageKey));
            } catch (e) {
                return null;
            }
        }
        return state;
    };

    Picker.prototype.isUntouched = function() {
        /**
         * Returns true if the state has not been touched (either it's a
         * completely clean state or one that only has found favorites
         * matching the state's initial favorites).
         */
        var i;
        var arrays = this.state.arrays;
        var initialFavorites = this.initialFavorites || [];

        // If something is in eliminated/survived, it's not untouched
        if (arrays.eliminated.length > 0 || arrays.survived.length > 0) {
            return false;
        }

        // If we've got nothing in eliminated/survived and nothing in favorites, it is untouched
        if (arrays.favorites.length === 0) {
            return true;
        }

        // We have found favorites, but nothing eliminated/survived: check if the favorites match the initial favorites, if any
        // If it's the wrong number of favorites, it's not untouched
        if (arrays.favorites.length !== initialFavorites.length) {
            return false;
        }
        for (i = 0; i < arrays.favorites.length; i++) {
            if (initialFavorites[i] !== arrays.favorites[i]) {
                // This favorite doesn't match, so it's not untouched
                return false;
            }
        }
        return true;
    };

    Picker.prototype.hasItems = function() {
        /**
         * Returns true if the picker has any items (that aren't filtered
         * out).
         */
        return this.state.items.length > 0;
    };

    /* ACTIONS */

    Picker.prototype.pick = function(picked) {
        this.state.pick(picked);
        this.pushHistory();
    };

    Picker.prototype.pass = function() {
        this.state.pass();
        this.pushHistory();
    };

    Picker.prototype.reset = function() {
        this.state.reset();
        this.pushHistory();
    };

    Picker.prototype.setSettings = function(settings) {
        this.state.setSettings(settings);
        this.pushHistory();
    };

    Picker.prototype.setFavorites = function(favorites) {
        this.state.setFavorites(favorites);
        this.pushHistory();
    };

    /* PICKER UTILITY FUNCTIONS */

    Picker.prototype.forEachItem = function(func) {
        /**
         * Executes func for each identifier in the picker's item map.
         */
        var identifier;
        var result;

        for (identifier in this.itemMap) {
            if (this.itemMap.hasOwnProperty(identifier)) {
                result = func(identifier);
                if (result) {
                    return result;
                }
            }
        }
    };

    Picker.prototype.mapItems = function(identifiers) {
        /**
         * Gets an array of full item objects corresponding to the given
         * identifiers.
         */
        var self = this;
        return map(identifiers, function(identifier) {
            return self.itemMap[identifier];
        });
    };

    /* GENERAL UTILITY FUNCTIONS */

    function isState(state) {
        /**
         * Returns true if the given state object has all the expected
         * properties (and can thus safely be passed into restoreState).
         */
        return (
            state &&
            typeof state === 'object' &&
            Array.isArray(state.eliminated) &&
            Array.isArray(state.survived) &&
            Array.isArray(state.current) &&
            Array.isArray(state.evaluating) &&
            Array.isArray(state.favorites) &&
            (!state.settings || typeof state.settings === 'object')
        );
    };

    function copyArray(array) {
        /**
         * Returns a deep copy of the given data array.
         */
        var result = [];
        var i;
        for (i = 0; i < array.length; i++) {
            if (array[i] && typeof array[i] === 'object') {
                if (Array.isArray(array[i])) {
                    result[i] = copyArray(array[i]);
                }
                else {
                    result[i] = copyObject(array[i]);
                }
            }
            else {
                result[i] = array[i];
            }
        }
        return result;
    }

    function copyObject() {
        /**
         * Returns a deep copy of the given object(s), with properties of later
         * objects overriding those of earlier objects.
         */
        var result = {};
        var a, key;

        for (a = 0; a < arguments.length; a++) {
            for (key in arguments[a]) {
                if (arguments[a].hasOwnProperty(key)) {
                    if (arguments[a][key] && typeof arguments[a][key] === 'object') {
                        if (Array.isArray(arguments[a][key])) {
                            result[key] = copyArray(arguments[a][key]);
                        }
                        else {
                            result[key] = copyObject(arguments[a][key]);
                        }
                    }
                    else {
                        result[key] = arguments[a][key];
                    }
                }
            }
        }
        return result;
    }

    function map(array, func) {
        /**
         * Returns an array containing the result of calling func on each item
         * in the input array.
         */
        var result = [];
        var i;
        for (i = 0; i < array.length; i++) {
            result[i] = func(array[i]);
        }
        return result;
    }

    function shuffle(array) {
        /**
         * Shuffles the given array to be in a random order.
         */
        var currentIndex = array.length, temporaryValue, randomIndex;

        while (0 !== currentIndex) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;

            temporaryValue = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temporaryValue;
        }

        return array;
    }

    function parseQueryString(qs) {
        /**
         * Parses a query string (a=b&c=d) into an object.
         */
        var query = {};
        var split = qs.split('&');
        var valueSplit;
        var i;

        for (i = 0; i < split.length; i++) {
            valueSplit = split[i].split('=');
            query[decodeURIComponent(valueSplit[0])] = valueSplit[1] ? decodeURIComponent(valueSplit[1]) : true;
        }
        return query;
    }

    return {
        Picker: Picker,
        PickerState: PickerState,
        isState: isState
    };
}));
