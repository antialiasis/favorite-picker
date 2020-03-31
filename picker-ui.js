'use strict';

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('jquery'));
    } else {
        root.PickerUI = factory(root.jQuery);
    }
}(typeof self !== 'undefined' ? self : this, function ($) {
    function PickerUI(picker, options) {
        var self = this;

        this.picker = picker;
        this.options = options;

        /* MESSAGE OPTIONS */

        this.messages = $.extend({
            reset: "Reset",
            mustSelect: "You must select something first! If you're indifferent, press Pass.",
            orderedAll: "You have ordered every available item!",
            noItems: "There are no items that fit your criteria! Set some different options and try again.",
            resetWarning: "Are you sure you wish to reset your state? All your found favorites and current progress will be lost."
        }, this.options.messages);

        /* MUTABLE UI STATE */

        this.canPick = true;

        /* UI ELEMENTS */

        this.elem = jquerify(options.elements || {});
        if (!this.elem.settings) {
            this.elem.settings = {};
        }

        /* EVENT HANDLERS FOR SETTINGS */

        for (var key in this.elem.settings) {
            if (this.elem.settings.hasOwnProperty(key)) {
                this.elem.settings[key].on('change', function() {
                    self.picker.setSettings(self.getSettings());
                    self.update(true);
                });
            }
        }

        /* PICKER UI EVENT HANDLERS */

        this.elem.evaluating.on('click', '.item', function(e) {
            e.preventDefault();
            self.select(this);
        }).on('dblclick', '.item', function(e) {
            // Prevent double-clicking from selecting the current item if some other items have been selected
            e.preventDefault();
            var selected = self.getSelected();
            var item = self.getItem(this);
            if (selected.length === 0 || selected.length === 1 && selected[0] === item) {
                self.pick([item]);
            }
        }).on('mousedown', '.item', function(e) {
            e.preventDefault();
        });

        this.elem.pick.on('click', function(e) {
            e.preventDefault();
            var selected = self.getSelected();
            if (selected.length === 0) {
                alert(self.messages.mustSelect);
            }
            else {
                self.pick(selected);
            }
        });

        this.elem.pass.on('click', function(e) {
            e.preventDefault();
            self.pass();
        });

        this.elem.undo.on('click', function(e) {
            e.preventDefault();
            self.undo();
        });

        this.elem.redo.on('click', function(e) {
            e.preventDefault();
            self.redo();
        });

        if (this.elem.reset) {
            this.elem.reset.on('click', function(e) {
                e.preventDefault();
                self.reset();
            });
        }

        if (this.elem.sharedListContinue) {
            this.elem.sharedListContinue.on('click', function(e) {
                e.preventDefault();
                self.picker.resetToFavorites($.map(self.picker.getSharedFavorites(), function(item) { return item.id; }));
                console.log(self.picker.getSettings());
                self.setSettings(self.picker.getSettings());
                self.update(true);
                self.dismissSharedList();
            });
        }

        if (this.elem.sharedListSkip) {
            this.elem.sharedListSkip.on('click', function(e) {
                e.preventDefault();
                self.dismissSharedList();
            });
        }

        function jquerify(obj) {
            var result = {}
            for (var key in obj) {
                if (key === 'settings') {
                    result[key] = jquerify(obj[key]);
                }
                else if (obj.hasOwnProperty(key)) {
                    result[key] = $(obj[key]);
                }
            }
            return result;
        }

        return this;
    }

    /* INITIALIZATION */

    PickerUI.prototype.initialize = function() {
        /**
         * Initializes UI.
         */
        this.setSettings(this.picker.getSettings());
        this.update();

        var sharedFavorites = this.picker.getSharedFavorites();
        if (sharedFavorites) {
            this.displaySharedList(sharedFavorites);
        }
    };

    /* GETTERS/SETTERS FOR SETTINGS */

    PickerUI.prototype.getSetting = function(setting) {
        var $elem = $(this.elem.settings[setting]);
        var type = $elem.attr("type");
        var values;
        var value;

        if (type === 'checkbox' || type === 'radio') {
            if ($elem.length === 1) {
                return $elem.prop("checked");
            }
            else {
                values = $.makeArray($elem.filter(":checked").map(function () {
                    var value = this.value;
                    if ($(this).hasClass("setting-number")) {
                        value *= 1;
                    }
                    return value;
                }));
                if (type === 'checkbox') {
                    return values;
                } else {
                    return values[0];
                }
            }
        }
        else {
            value = $elem.val();
            if (type === 'number' || $(this).hasClass("setting-number")) {
                value *= 1;
            }
            return value;
        }
    };

    PickerUI.prototype.setSetting = function(setting, value) {
        var $elem = $(this.elem.settings[setting]);
        var type = $elem.attr("type");

        if (type === 'checkbox' || type === 'radio') {
            if ($elem.length === 1) {
                $elem.prop("checked", value);
            }
            else {
                $elem.each(function () {
                    var val = this.value;
                    if ($(this).hasClass("setting-number")) {
                        val *= 1;
                    }
                    $(this).prop("checked", $.isArray(value) ? value.indexOf(val) !== -1 : value === val);
                });
            }
        }
        else {
            if (type === 'number' || $(this).hasClass("setting-number")) {
                value *= 1;
            }
            $elem.val(value);
        }
    };

    PickerUI.prototype.getSettings = function() {
        var settings = {};
        var setting;

        for (setting in this.elem.settings) {
            if (this.elem.settings.hasOwnProperty(setting)) {
                settings[setting] = this.getSetting(setting);
            }
        }
        return settings;
    };

    PickerUI.prototype.setSettings = function(settings) {
        var setting;

        for (setting in settings) {
            if (settings.hasOwnProperty(setting)) {
                this.setSetting(setting, settings[setting]);
            }
        }
    };

    /* SELECTION */

    PickerUI.prototype.select = function(elem) {
        /**
         * Selects the given element.
         */
        $(elem).toggleClass("selected");
    };

    PickerUI.prototype.getItem = function(elem) {
        /**
         * Gets the item associated with this element.
         */
        return $(elem).data('item');
    };

    PickerUI.prototype.getSelected = function() {
        /**
         * Returns a list of the currently selected items.
         */
        var self = this;
        return this.elem.evaluating.find(".selected").map(function(i, item) {
            return self.getItem(this);
        }).get();
    };

    /* UI UPDATE FUNCTIONS */

    PickerUI.prototype.display = function(func, quick) {
        /**
         * If quick is true, run the given display func immediately.
         * Otherwise, fade out the item list, run it, then fade in
         * again.
         */
        var self = this;

        if (quick) {
            func();
        }
        else {
            this.elem.evaluating.animate({opacity: 0}, 'fast', function() {
                func();
                self.elem.evaluating.animate({opacity: 1}, 'fast');
            });
        }
    };

    PickerUI.prototype.displayEmpty = function() {
        /**
         * Displays an empty message.
         */
        var item = this.wrapItem((this.picker.hasItems() ? (this.messages.orderedAll + ' ') : this.messages.noItems)).addClass("notice");
        if (this.picker.hasItems()) {
            item.append(this.makeResetButton(this.messages.reset + '?'));
        }
        this.elem.evaluating.empty().width('100%').append(item);
        this.updatePickPass(false);
    };

    PickerUI.prototype.displayBatch = function() {
        /**
         * Displays the current evaluating batch of items.
         */
        var self = this;
        var batch = this.picker.getEvaluating();
        this.elem.evaluating.empty();
        $.each(batch, function() {
            self.elem.evaluating.append(self.getItemElem(this, self.picker.getSettings()));
        });
        this.updatePickPass(true);
    };

    PickerUI.prototype.updateHistoryButtons = function() {
        /**
         * Updates the undo/redo buttons based on the state.
         */
        this.elem.undo.toggleClass("disabled", !this.picker.canUndo());
        this.elem.redo.toggleClass("disabled", !this.picker.canRedo());
    };

    PickerUI.prototype.updatePickPass = function(canPick) {
        /**
         * Enables/disables the pick/pass buttons based on canPick.
         */
        this.elem.pick.toggleClass("disabled", !canPick).prop("disabled", !canPick);
        this.elem.pass.toggleClass("disabled", !canPick).prop("disabled", !canPick);
    };

    PickerUI.prototype.updateFavorites = function() {
        /**
         * Update the found favorites list according to the state.
         */
        var self = this;
        var favorites = this.picker.getFavorites();
        this.elem.favorites.empty();
        $.each(favorites, function() {
            self.elem.favorites.append(self.getItemElem(this, self.picker.getSettings()));
        });
        if (this.elem.shortcodeLink && this.picker.options.favoritesQueryParam && this.picker.options.shortcodeLength) {
            this.elem.shortcodeLink.attr('href', this.picker.getShortcodeLink()).toggle(favorites.length > 0);
        }
    };

    PickerUI.prototype.update = function(quick) {
        /**
         * Perform a full UI update based on the current state. The update is
         * immediate if quick is true; otherwise, the Pokémon display will be
         * faded out/in.
         */
        var self = this;

        this.display(function() {
            if (self.picker.getEvaluating().length === 0) {
                self.displayEmpty();
            }
            else {
                self.displayBatch()
            }
            self.updateFavorites();
            if (self.options.onUpdate) {
                self.options.onUpdate.call(self);
            }
            self.canPick = true;
        }, quick);
        this.updateHistoryButtons();
    };

    PickerUI.prototype.dismissSharedList = function() {
        /**
         * Dismiss a shared list.
         */
        if (this.options.dismissSharedList) {
            return this.options.dismissSharedList.call(this);
        }
        if (history.replaceState) {
            history.replaceState({}, document.title, window.location.pathname);
        }
        this.elem.sharedListContainer.hide();
    };

    PickerUI.prototype.displaySharedList = function(favorites) {
        /**
         * Display the given favorites as a shared list.
         */
        if (this.options.displaySharedList) {
            return this.options.displaySharedList.call(this, favorites);
        }
        var self = this;

        if (!self.elem.sharedList || !self.elem.sharedListContainer) return;

        $.each(favorites, function() {
            self.elem.sharedList.append(self.getItemElem(this, self.picker.getSettings()));
        });

        this.elem.sharedListContainer.show();
    };

    /* MAIN PICKER FUNCTIONALITY */

    PickerUI.prototype.pick = function(items) {
        /**
         * Pick the given items.
         */
        if (!this.canPick) return;
        this.canPick = false;
        this.picker.pick(items);
        this.update();
    };

    PickerUI.prototype.pass = function() {
        /**
         * Pass on this batch.
         */
        if (!this.canPick) return;
        this.canPick = false;
        this.picker.pass();
        this.update();
    };

    PickerUI.prototype.undo = function() {
        /**
         * Undo the last action.
         */
        if (this.picker.canUndo()) {
            this.picker.undo();
            this.setSettings(this.picker.getSettings());
            this.update();
        }
    };

    PickerUI.prototype.redo = function() {
        /**
         * Redo the last undone action.
         */
        if (this.picker.canRedo()) {
            this.picker.redo();
            this.setSettings(this.picker.getSettings());
            this.update();
        }
    };

    PickerUI.prototype.reset = function() {
        /**
         * Reset the state (prompting if the state is not untouched).
         */
        var untouched = this.picker.isUntouched();
        if (untouched || confirm(this.messages.resetWarning)) {
            this.picker.reset();
            this.update();
        }
    };

    /* UI UTILITY FUNCTIONS */

    PickerUI.prototype.wrapItem = function(itemContent) {
        /**
         * Wraps the given item content in an HTML structure and returns it.
         */
        if (this.options.wrapItem) {
            return $(this.options.wrapItem(itemContent));
        }
        return $('<li></li>').append(itemContent);
    };

    PickerUI.prototype.getItemElem = function(item, settings) {
        /**
         * Creates and returns an element or jQuery object for an item,
         * to be inserted into the evaluating element.
         * The behaviour of this function can be overridden with the
         * getItemElem setting. By default, if the getImageUrl setting
         * is set, it returns an image with that URL; otherwise, it simply
         * returns a plain text list item.
         */
        var itemContent;
        var itemName;
        itemName = item.name || item.id;
        if (this.options.getItemElem) {
            return $(this.options.getItemElem(item, settings)).addClass('item').data('item', item.id);
        }
        if (item.image || this.options.getItemImageUrl) {
            itemContent = $('<img src="' + (this.options.getItemImageUrl ? this.options.getItemImageUrl(item, settings) : item.image) + '" alt="' + itemName + '" title="' + itemName + '">');
        }
        else {
            itemContent = $('<span>' + itemName + '</span>');
        }
        return this.wrapItem(itemContent).addClass('item').data('item', item.id);
    };

    PickerUI.prototype.makeResetButton = function(text) {
        /**
         * Creates and returns a reset button.
         */
        var self = this;
        return $('<button type="button">' + (text || this.messages.reset) + '</button>').on('click', function() {
            self.reset();
        });
    };

    return PickerUI;
}));
