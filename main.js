/*
Synonyms Plugin
===============
Show a list of synonyms for the current word in the editor in the right sidebar. Click to insert.
*/

const { Plugin, ItemView, setTooltip, requestUrl, Notice } = require('obsidian');

const SYNONYM_VIEW = 'synonym-view';

const Config = {
  maxResults: 20, // limit of how many words per heading to return
  maxWords: 10, // limit to selection size, max no. of words
  dictUrl: 'https://en.wiktionary.org/api/rest_v1/page/definition/',
  synUrl: 'https://api.datamuse.com/words?',
  synonymArg: 'rel_syn=',
  antonymArg: 'rel_ant=',
  similarArg: 'ml=',
};

const Lang = {
  name: 'Synonyms',
  introHdr: 'Synonyms',
  synonymsHdr: 'Synonyms',
  antonymsHdr: 'Antonyms',
  similarHdr: 'Similar meanings',
  definitionsHdr: 'Definitions',
  definitionCopied: 'Word definition copied to clipboard',
  clearTip: 'Clear search',
  intro: 'Search for synonyms, antonyms, similar meanings, and dictionary definitions.',
  source1: 'Synonyms: <a href="https://api.datamuse.com/words?rel_syn=example">Datamuse</a>',
  source2: 'Dictionary: <a href="https://en.wiktionary.org/api/rest_v1/page/definition/example">Wiktionary</a>',
  more: ' more...',
  searchingSyn: 'Searching for synonyms from 🌐Datamuse...',
  searchingDef: 'Searching for definitions from 🌐Wiktionary...',
  searchPlc: 'Find synonyms & definitions....',
  selected: 'Find word at the cursor',
  selectedTip: 'Uses current selection if available',
  stemTip: 'Click to find the word stem',
  insertWordTip: 'Click a word to replace the word at the cursor',
  copyDefinitionTip: 'Click a definition to copy it to the clipboard',
};

class SynonymSidebarPlugin extends Plugin {
  constructor() {
    super(...arguments);
  }

  async onload() {
    this.registerView(
      SYNONYM_VIEW, 
      (leaf) => (this.view = new SynonymSidebarView(leaf)),
    );

    this.app.workspace.onLayoutReady(this.activateView.bind(this));
    
    console.log('%c' + this.manifest.name + ' ' + this.manifest.version +
      ' loaded', 'background-color: firebrick; padding:4px; border-radius:4px');
  }
  
  onunload() {}

  async activateView() {
    const { workspace } = this.app;
    const [leaf] = workspace.getLeavesOfType(SYNONYM_VIEW);
    if (!leaf) {
      await this.app.workspace
        .getRightLeaf(false) // false = no split
        .setViewState({
          type: SYNONYM_VIEW,
          active: true,
        });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}

class SynonymSidebarView extends ItemView {
  constructor(leaf) {
    super(leaf);
  }

  getViewType() {
    return SYNONYM_VIEW;
  }

  getDisplayText() {
    return Lang.name;
  }

  getIcon() {
    return 'book-a';
  }

  async onOpen() {
    let lookup = '';
    let results_cache = [];
    this.contentEl.empty();

    // SEARCH BAR
    const nav = this.contentEl.createDiv({ cls: 'nav-header'});
    const row = nav.createDiv({ cls: 'search-row' });
    const cont = row.createDiv({ cls: 'search-input-container' });
    const search_box = cont.createEl('input', {
      type: 'search',
      placeholder: Lang.searchPlc,
    });
    const search_clear = cont.createDiv( {
      cls: 'search-input-clear-button',
    });
    setTooltip(search_clear, Lang.clearTip);
    
        // PLUGIN CONTAINER
    const content = this.contentEl.createDiv({ cls: 'synonym-plugin' });

    // START VIEW
    const start_view = content.createDiv();
    start_view.createDiv({ text: Lang.introHdr.toUpperCase(), cls: 'syn-title' });
    start_view.createDiv({ text: Lang.intro, cls: 'syn-intro' });
    start_view.createDiv({ cls: 'syn-ex' }).innerHTML = Lang.source1;
    start_view.createDiv({ cls: 'syn-ex' }).innerHTML = Lang.source2;
    const selected_btn = start_view.createEl('button', {
      text: Lang.selected,
      cls: 'syn-button',
    });
    setTooltip(selected_btn, Lang.selectedTip);

    // WORD VIEW
    const word_view = content.createDiv({ 
      text: '🔅', 
      cls: 'syn-lookup',
    });
    setTooltip(word_view, Lang.stemTip);
    word_view.hide();

    // SYNONYM VIEW
    const search_syn_view = content.createDiv({
      text: Lang.searchingSyn,
      cls: 'syn-info',
    });
    search_syn_view.hide();

    const synonym_view = content.createDiv();

    // DEFINITION VIEW
    const search_def_view = content.createDiv({
      text: Lang.searchingDef,
      cls: 'syn-info',
    });
    search_def_view.hide();

    const definition_view = content.createDiv();

    // *** EVENTS ****

    word_view.onclick = () => {
      const stem = stemmer2(search_box.value);
      if (stem !== search_box.value) {
        search_box.value = stem;
        search_box.onsearch();
      }
    }

    search_box.onsearch = () => {
      lookup = search_box.value;
      if (lookup !== '') {
        start_view.hide();
        word_view.innerText = lookup;
        word_view.show()
        search_syn_view.show();
        lib.fetchSynonyms(lookup).then((results) => {
          search_syn_view.hide();
          showSynonyms(results, synonym_view);
          results_cache = results; // needed for the 'More..' button feature
        });
        search_def_view.show();
        lib.fetchDefinitions(lookup).then((word) => {
          search_def_view.hide();
          showDefinitions(word, definition_view);
          showFiller(definition_view);
        });
      }
    };

    search_clear.onclick = () => {
      search_box.value = '';
      synonym_view.empty();
      definition_view.empty();
      word_view.hide();
      start_view.show();
    };

    selected_btn.onclick = () => {
      search_box.value = lib.currentWord(this.app);
      search_box.onsearch();
    };
    /**
     * Replace editor selection with clicked synonym
     * Lookup the currently selected word in the editor
     * @param {event} evt
     */
    synonym_view.onclick = (evt) => {
      if (evt.target.className === 'syn-word') {
        const word = evt.target.textContent;
        lib.currentWord(this.app, word);
      }
      if (evt.target.className === 'syn-button') {
        showSynonyms(results_cache, synonym_view, true);
      }
    }

    definition_view.onclick = (evt) => {
      if (evt.target.className === 'syn-def') {
        navigator.clipboard.writeText('*' + search_box.value + '* 🔅' + evt.target.textContent);
        new Notice(Lang.definitionCopied, 2000);
      }
    }

    // RENDER functions
    // ****************

    /**
     * Render the datamuse json results to HTML
     * @param {Array<SynonymResult>} results list of synonyms, antonyms and similar words
     * @param {HTMLElement} view where to show the results
     */
    function showSynonyms(results, view, all = false) {
      view.empty();
      let heading, len;
      for (const result of results) {
        heading = result.Heading.toUpperCase();
        len = result.Words.length;
        if (len > 0) {
          const hdr = view.createDiv({ text: heading, cls: 'syn-heading' });
          setTooltip(hdr, Lang.insertWordTip);
          const end = all ? len : Config.maxResults;
          result.Words.slice(0, end).map((word) => {
            view.createSpan( { text: word.word, cls: 'syn-word' });
          });
        } else {
          view.createDiv({ text: heading, cls: 'syn-none syn-heading' });
        }
      }
      if (!all && len > Config.maxResults) {
        const more = len - Config.maxResults;
        view.createEl('button', { text: more + Lang.more, cls: 'syn-button' });
      }
    }

    /**
     * Render the word definitions from Wiktionary to HTML
     * @param {JSON} word
     * @param {HTMLElement} view
     */
    function showDefinitions(word, view) {
      view.empty();
      if (word) {
        const hdr = view.createDiv({ text: Lang.definitionsHdr.toUpperCase(), cls: 'syn-heading' });
        setTooltip(hdr, Lang.copyDefinitionTip);
        word.forEach((part) => {
          const POS = view.createDiv({ text: part.partOfSpeech, cls: 'syn-heading' });
          part.definitions.forEach((def) => {
            POS.createDiv({
              text: lib.stripMarkup(def.definition),
              cls: 'syn-def',
            });
            if (def.examples !== undefined) {
              def.examples.forEach((ex) => {
                POS.createDiv({
                  text: '“' + lib.stripMarkup(ex) + '”',
                  cls: 'syn-ex',
                });
              });
            }
          });
        });
      } else {
        view.createDiv({ text: Lang.definitionsHdr.toUpperCase(), cls: 'syn-none' });
      }
    }

    function showFiller(view) {
      view.createDiv({ text: '🔅', cls: 'syn-info' });
    }
  }
  async onClose() {
    this.unload();
  }
}

class lib {
  /**
   * Get or set the editor selection
   * In the most recent editor, grabs either:
   * 1. The selected text (up to max number of words); 
   *    NOTE: paragraphs of words make no sense in this context
   * 2. The word at the cursor position
   *
   * @param {obsidian.App} app
   * @param {string} replacement
   * @returns {string}
   */
  static currentWord(app, replacement = '') {
    const view = app.workspace.getMostRecentLeaf().view;
    if (view) {
      const editor = view.editor;
      // If there is no selection try to use the word at the cursor position
      if (!editor.somethingSelected()) {
        selectWordAtCursor(editor);
      }
      if (editor.somethingSelected) {
        if (replacement !== '') {
          editor.replaceSelection(replacement);
          selectWordAtCursor(editor);
        } else {
          let sel = editor.getSelection();
          if (sel.indexOf(' ') >= 0) {
            sel = this.firstXWords(sel, Config.maxWords);
          }
          return sel;
        }
      }
    }
    return '';

    function selectWordAtCursor(editor) {
      const word_pos = editor.wordAt(editor.getCursor());
      if (word_pos) {
        editor.setSelection(word_pos.from, word_pos.to);
      }
    }
  }

  /**
   * Fetches the synonyms from Datamuse API
   * @typedef {{Heading: string, Word: Array<string>}} SynonymResult
   * @param {string} lookup
   * @returns {Array<SynonymResult>}
   */
  static async fetchSynonyms(lookup) {
    let results = [];
    try {
      let res = await Promise.all([
        fetchUrl(Config.synUrl + Config.synonymArg + lookup),
        fetchUrl(Config.synUrl + Config.antonymArg + lookup),
        fetchUrl(Config.synUrl + Config.similarArg + lookup),
      ]);

      results = [
        { Heading: Lang.synonymsHdr, Words: res[0] },
        { Heading: Lang.antonymsHdr, Words: res[1] },
        { Heading: Lang.similarHdr, Words: res[2] },
      ];
    } catch (error) {
      console.log(error);
    }
    return results;
    
    async function fetchUrl(url) {
      let result = null;
      let response = await requestUrl(url);
      if (response.status === 200) {
        result = await response.json;
      }
      return result;
    }
  }

  /**
   * Fetch the word definition from Wikionary API
   * @param {string} word
   * @returns {JSON|undefined}
   */
  static async fetchDefinitions(word) {
    try {
      word = word.toLowerCase(); // online lookup requires lower case
      let res = await requestUrl(Config.dictUrl + word);
      if (res.status === 200) {
        let raw = await res.json;
        return raw.en; // just the English results
      }
    } catch (error) {
      console.log(error);
    }
    return undefined;
  }

  /**
   * Returns the first X words from the sentence provided
   * @param {string} sentence
   * @param {number} count how many words
   * @returns {string} Check for empty!
   */
  static firstXWords(sentence, count) {
    const rgx = new RegExp('((\\s*\\S+){' + count + '})([\\s\\S]*)', 'gm');
    let match = rgx.exec(sentence);
    return match !== null ? match[1] : '';
  }

  /**
   * Remove html markup from text
   * @param {string} html
   * @returns {string} plain text
   */
  static stripMarkup(html) {
    let doc = new DOMParser().parseFromString(html, 'text/html');
    let text = doc.body.textContent ?? '';
    return text;
  }

}

// https://github.com/words/stemmer
const stemmer = (function() {
  // Standard suffix manipulations.
  /** @type {Record<string, string>} */
  const step2list = {
    ational: 'ate',
    tional: 'tion',
    enci: 'ence',
    anci: 'ance',
    izer: 'ize',
    bli: 'ble',
    alli: 'al',
    entli: 'ent',
    eli: 'e',
    ousli: 'ous',
    ization: 'ize',
    ation: 'ate',
    ator: 'ate',
    alism: 'al',
    iveness: 'ive',
    fulness: 'ful',
    ousness: 'ous',
    aliti: 'al',
    iviti: 'ive',
    biliti: 'ble',
    logi: 'log'
  }

  /** @type {Record<string, string>} */
  const step3list = {
    icate: 'ic',
    ative: '',
    alize: 'al',
    iciti: 'ic',
    ical: 'ic',
    ful: '',
    ness: ''
  }

  // Consonant-vowel sequences.
  const consonant = '[^aeiou]'
  const vowel = '[aeiouy]'
  const consonants = '(' + consonant + '[^aeiouy]*)'
  const vowels = '(' + vowel + '[aeiou]*)'

  const gt0 = new RegExp('^' + consonants + '?' + vowels + consonants)
  const eq1 = new RegExp(
    '^' + consonants + '?' + vowels + consonants + vowels + '?$'
  )
  const gt1 = new RegExp('^' + consonants + '?(' + vowels + consonants + '){2,}')
  const vowelInStem = new RegExp('^' + consonants + '?' + vowel)
  const consonantLike = new RegExp('^' + consonants + vowel + '[^aeiouwxy]$')

  // Exception expressions.
  const sfxLl = /ll$/
  const sfxE = /^(.+?)e$/
  const sfxY = /^(.+?)y$/
  const sfxIon = /^(.+?(s|t))(ion)$/
  const sfxEdOrIng = /^(.+?)(ed|ing)$/
  const sfxAtOrBlOrIz = /(at|bl|iz)$/
  const sfxEED = /^(.+?)eed$/
  const sfxS = /^.+?[^s]s$/
  const sfxSsesOrIes = /^.+?(ss|i)es$/
  const sfxMultiConsonantLike = /([^aeiouylsz])\1$/
  const step2 =
    /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/
  const step3 = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/
  const step4 =
    /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/

  /**
   * Get the stem from a given value.
   *
   * @param {string} value
   *   Value to stem.
   * @returns {string}
   *   Stem for `value`
   */
  // eslint-disable-next-line complexity
  return function stemmer(value) {
    let result = String(value).toLowerCase()

    // Exit early.
    if (result.length < 3) {
      return result
    }

    /** @type {boolean} */
    let firstCharacterWasLowerCaseY = false

    // Detect initial `y`, make sure it never matches.
    if (
      result.codePointAt(0) === 121 // Lowercase Y
    ) {
      firstCharacterWasLowerCaseY = true
      result = 'Y' + result.slice(1)
    }

    // Step 1a.
    if (sfxSsesOrIes.test(result)) {
      // Remove last two characters.
      result = result.slice(0, -2)
    } else if (sfxS.test(result)) {
      // Remove last character.
      result = result.slice(0, -1)
    }

    /** @type {RegExpMatchArray|null} */
    let match

    // Step 1b.
    if ((match = sfxEED.exec(result))) {
      if (gt0.test(match[1])) {
        // Remove last character.
        result = result.slice(0, -1)
      }
    } else if ((match = sfxEdOrIng.exec(result)) && vowelInStem.test(match[1])) {
      result = match[1]

      if (sfxAtOrBlOrIz.test(result)) {
        // Append `e`.
        result += 'e'
      } else if (sfxMultiConsonantLike.test(result)) {
        // Remove last character.
        result = result.slice(0, -1)
      } else if (consonantLike.test(result)) {
        // Append `e`.
        result += 'e'
      }
    }

    // Step 1c.
    if ((match = sfxY.exec(result)) && vowelInStem.test(match[1])) {
      // Remove suffixing `y` and append `i`.
      result = match[1] + 'i'
    }

    // Step 2.
    if ((match = step2.exec(result)) && gt0.test(match[1])) {
      result = match[1] + step2list[match[2]]
    }

    // Step 3.
    if ((match = step3.exec(result)) && gt0.test(match[1])) {
      result = match[1] + step3list[match[2]]
    }

    // Step 4.
    if ((match = step4.exec(result))) {
      if (gt1.test(match[1])) {
        result = match[1]
      }
    } else if ((match = sfxIon.exec(result)) && gt1.test(match[1])) {
      result = match[1]
    }

    // Step 5.
    if (
      (match = sfxE.exec(result)) &&
      (gt1.test(match[1]) ||
        (eq1.test(match[1]) && !consonantLike.test(match[1])))
    ) {
      result = match[1]
    }

    if (sfxLl.test(result) && gt1.test(result)) {
      result = result.slice(0, -1)
    }

    // Turn initial `Y` back to `y`.
    if (firstCharacterWasLowerCaseY) {
      result = 'y' + result.slice(1)
    }

    return result
  }
})();

// https://github.com/winkjs/wink-porter2-stemmer/blob/master/src/wink-porter2-stemmer.js
const stemmer2 = (function() {
//     wink-porter2-stemmer
//     Implementation of Porter Stemmer Algorithm V2 by Dr Martin F Porter
//
//     Copyright (C) 2017-19  GRAYPE Systems Private Limited
//
//     This file is part of “wink-porter2-stemmer”.
//
//     Permission is hereby granted, free of charge, to any person obtaining a
//     copy of this software and associated documentation files (the "Software"),
//     to deal in the Software without restriction, including without limitation
//     the rights to use, copy, modify, merge, publish, distribute, sublicense,
//     and/or sell copies of the Software, and to permit persons to whom the
//     Software is furnished to do so, subject to the following conditions:
//
//     The above copyright notice and this permission notice shall be included
//     in all copies or substantial portions of the Software.
//
//     THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
//     OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//     FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
//     THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//     LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//     FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//     DEALINGS IN THE SOFTWARE.

// Implements the Porter Stemmer Algorithm V2 by Dr Martin F Porter.
// Reference: https://snowballstem.org/algorithms/english/stemmer.html

// ## Regex Definitions

// Regex definition of `double`.
var rgxDouble = /(bb|dd|ff|gg|mm|nn|pp|rr|tt)$/;
// Definition for Step Ia suffixes.
var rgxSFXsses = /(.+)(sses)$/;
var rgxSFXiedORies2 = /(.{2,})(ied|ies)$/;
var rgxSFXiedORies1 = /(.{1})(ied|ies)$/;
var rgxSFXusORss = /(.+)(us|ss)$/;
var rgxSFXs = /(.+)(s)$/;
// Definition for Step Ib suffixes.
var rgxSFXeedlyOReed = /(.*)(eedly|eed)$/;
var rgxSFXedORedlyORinglyORing = /([aeiouy].*)(ed|edly|ingly|ing)$/;
var rgxSFXatORblORiz = /(at|bl|iz)$/;
// Definition for Step Ic suffixes.
var rgxSFXyOR3 = /(.+[^aeiouy])([y3])$/;
// Definition for Step II suffixes; note we have spot the longest suffix.
var rgxSFXstep2 = /(ization|ational|fulness|ousness|iveness|tional|biliti|lessli|entli|ation|alism|aliti|ousli|iviti|fulli|enci|anci|abli|izer|ator|alli|bli|ogi|li)$/;
var rgxSFXstep2WithReplacements = [
  // Length 7.
  { rgx: /ational$/, replacement: 'ate' },
  { rgx: /ization$/, replacement: 'ize' },
  { rgx: /fulness$/, replacement: 'ful' },
  { rgx: /ousness$/, replacement: 'ous' },
  { rgx: /iveness$/, replacement: 'ive' },
  // Length 6.
  { rgx: /tional$/, replacement: 'tion' },
  { rgx: /biliti$/, replacement: 'ble' },
  { rgx: /lessli$/, replacement: 'less' },
  // Length 5.
  { rgx: /iviti$/, replacement: 'ive' },
  { rgx: /ousli$/, replacement: 'ous' },
  { rgx: /ation$/, replacement: 'ate' },
  { rgx: /entli$/, replacement: 'ent' },
  { rgx: /(.*)(alism|aliti)$/, replacement: '$1al' },
  { rgx: /fulli$/, replacement: 'ful' },
  // Length 4.
  { rgx: /alli$/, replacement: 'al' },
  { rgx: /ator$/, replacement: 'ate' },
  { rgx: /izer$/, replacement: 'ize' },
  { rgx: /enci$/, replacement: 'ence' },
  { rgx: /anci$/, replacement: 'ance' },
  { rgx: /abli$/, replacement: 'able' },
  // Length 3.
  { rgx: /bli$/, replacement: 'ble' },
  { rgx: /(.*)(l)(ogi)$/, replacement: '$1$2og' },
  // Length 2.
  { rgx: /(.*)([cdeghkmnrt])(li)$/, replacement: '$1$2' }
];
// Definition for Step III suffixes; once again spot the longest one first!
var rgxSFXstep3 = /(ational|tional|alize|icate|iciti|ative|ical|ness|ful)$/;
var rgxSFXstep3WithReplacements = [
  { rgx: /ational$/, replacement: 'ate' },
  { rgx: /tional$/, replacement: 'tion' },
  { rgx: /alize$/, replacement: 'al' },
  { rgx: /(.*)(icate|iciti|ical)$/, replacement: '$1ic' },
  { rgx: /(ness|ful)$/, replacement: '' },
];
// Definition for Step IV suffixes.
var rgxSFXstep4 = /(ement|ance|ence|able|ible|ment|ant|ent|ism|ate|iti|ous|ive|ize|al|er|ic)$/;
var rgxSFXstep4Full = /(ement|ance|ence|able|ible|ment|ant|ent|ism|ate|iti|ous|ive|ize|ion|al|er|ic)$/;
var rgxSFXstep4ion = /(.*)(s|t)(ion)$/;
// Exceptions Set I.
var exceptions1 = Object.create( null );
// Mapped!
exceptions1.skis = 'ski';
exceptions1.skies = 'sky';
exceptions1.dying = 'die';
exceptions1.lying = 'lie';
exceptions1.tying = 'tie';
exceptions1.idly = 'idl';
exceptions1.gently = 'gentl';
exceptions1.ugly = 'ugli';
exceptions1.early = 'earli';
exceptions1.only = 'onli';
exceptions1.singly = 'singl';
// Invariants!
exceptions1.sky = 'sky';
exceptions1.news = 'news';
exceptions1.atlas = 'atlas';
exceptions1.cosmos = 'cosmos';
exceptions1.bias = 'bias';
exceptions1.andes = 'andes';

// Exceptions Set II.
// Note, these are to be treated as full words.
var rgxException2 = /^(inning|outing|canning|herring|proceed|exceed|succeed|earring)$/;

// ## Private functions

// ### prelude
/**
 * Performs initial pre-processing by transforming the input string `s` as
 * per the replacements.
 *
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var prelude = function ( s ) {
  return ( s
            // Handle `y`'s.
            .replace( /^y/, '3' )
            .replace( /([aeiou])y/, '$13' )
            // Handle apostrophe.
            .replace( /\’s$|\'s$/, '' )
            .replace( /s\’$|s\'$/, '' )
            .replace( /[\’\']$/, '' )
         );
}; // prelude()

// ### isShort
/**
 * @param {String} s Input string
 * @return {Boolean} `true` if `s` is a short syllable, `false` otherwise
 * @private
 */
var isShort = function ( s ) {
  // (a) a vowel followed by a non-vowel other than w, x or 3 and
  // preceded by a non-vowel, **or** (b) a vowel at the beginning of the word
  // followed by a non-vowel.
  return (
    (
      (
        ( /[^aeiouy][aeiouy][^aeiouywx3]$/ ).test( s ) ||
        ( /^[aeiouy][^aeiouy]{0,1}$/ ).test( s ) // Removed this new changed??
      )
    )
  );
}; // isShort()

// ### markRegions
/**
 * @param {String} s Input string
 * @return {Object} the `R1` and `R2` regions as an object from the input string `s`.
 * @private
 */
var markRegions = function ( s ) {
  // Matches of `R1` and `R2`.
  var m1, m2;
  // To detect regions i.e. `R1` and `R2`.
  var rgxRegions = /[aeiouy]+([^aeiouy]{1}.+)/;
  m1 = rgxRegions.exec( s );
  if ( !m1 ) return ( { r1: '', r2: '' } );
  m1 = m1[ 1 ].slice( 1 );
  // Handle exceptions here to prevent over stemming.
  m1 = ( ( /^(gener|commun|arsen)/ ).test( s ) ) ? s.replace( /^(gener|commun|arsen)(.*)/, '$2') : m1;
  m2 = rgxRegions.exec( m1 );
  if ( !m2 ) return ( { r1: m1, r2: '' } );
  m2 = m2[ 1 ].slice( 1 );
  return ( { r1: m1, r2: m2 } );
}; // markRegions()

// ### step1a
/**
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var step1a = function ( s ) {
  var wordPart;
  if ( rgxSFXsses.test( s ) ) return ( s.replace( rgxSFXsses, '$1ss' ) );
  if ( rgxSFXiedORies2.test( s ) ) return ( s.replace( rgxSFXiedORies2, '$1i' ) );
  if ( rgxSFXiedORies1.test( s ) ) return ( s.replace( rgxSFXiedORies1, '$1ie' ) );
  if ( rgxSFXusORss.test( s ) ) return ( s );
  wordPart = s.replace( rgxSFXs, '$1' );
  if ( ( /[aeiuouy](.+)$/ ).test( wordPart ) ) return ( s.replace( rgxSFXs, '$1' ) );
  return ( s );
}; // step1a()

// ### step1b
/**
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var step1b = function ( s ) {
  var rgn = markRegions( s ),
  sd;
  // Search for the longest among the `eedly|eed` suffixes.
  if ( rgxSFXeedlyOReed.test( s ) )
    // Replace by ee if in R1.
    return ( rgxSFXeedlyOReed.test( rgn.r1 ) ? s.replace( rgxSFXeedlyOReed, '$1ee' ) : s );
  // Delete `ed|edly|ingly|ing` if the preceding word part contains a vowel.
  if ( rgxSFXedORedlyORinglyORing.test( s ) ) {
    sd = s.replace( rgxSFXedORedlyORinglyORing, '$1' );
    rgn = markRegions( sd );
    // And after deletion, return either
    return ( rgxSFXatORblORiz.test( sd ) ) ? ( sd + 'e' ) :
            // or
            ( rgxDouble.test( sd ) ) ? ( sd.replace( /.$/, '' ) ) :
              // or
              ( ( isShort( sd ) ) && ( rgn.r1 === '' ) ) ? ( sd + 'e' ) :
                // or
                sd;
  }
  return ( s );
}; // step1b()

// ### step1c
/**
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var step1c = function ( s ) {
  return ( s.replace( rgxSFXyOR3, '$1i') );
}; // step1c()

// ### step2
/**
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var step2 = function ( s ) {
  var i, imax,
      rgn = markRegions( s ),
      us; // updated s.
  var match = s.match( rgxSFXstep2 );
  match = ( match === null ) ? '$$$$$' : match[ 1 ];
  if ( rgn.r1.indexOf( match ) !== -1 ) {
    for ( i = 0, imax = rgxSFXstep2WithReplacements.length; i < imax; i += 1 ) {
      us = s.replace( rgxSFXstep2WithReplacements[ i ].rgx, rgxSFXstep2WithReplacements[ i ].replacement );
      if ( s !== us ) return ( us );
    }
  }
  return ( s );
}; // step2()

// ### step3
/**
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var step3 = function ( s ) {
  var i, imax,
      rgn = markRegions( s ),
      us; // updated s.
  var match = s.match( rgxSFXstep3 );
  match = ( match === null ) ? '$$$$$' : match[ 1 ];

  if ( rgn.r1.indexOf( match ) !== -1 ) {
    for ( i = 0, imax = rgxSFXstep3WithReplacements.length; i < imax; i += 1 ) {
      us = s.replace( rgxSFXstep3WithReplacements[ i ].rgx, rgxSFXstep3WithReplacements[ i ].replacement );
      if ( s !== us ) return ( us );
    }
    if ( ( /ative/ ).test( rgn.r2 ) ) return s.replace( /ative$/, '' );
  }
  return ( s );
}; // step3()

// ### step4
/**
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var step4 = function ( s ) {
  var rgn = markRegions( s );
  var match = s.match( rgxSFXstep4Full );
  match = ( match === null ) ? '$$$$$' : match[ 1 ];
  if ( rgxSFXstep4Full.test( s ) &&  rgn.r2.indexOf( match ) !== -1 ) {
    return rgxSFXstep4.test( s ) ? s.replace( rgxSFXstep4, '' ) :
    (
      rgxSFXstep4ion.test( s ) ?
      s.replace( rgxSFXstep4ion, '$1$2') :
      s
    );
  }
  return ( s );
}; // step4()

// ### step5
/**
 * @param {String} s Input string
 * @return {String} Processed string
 * @private
 */
var step5 = function ( s ) {
  var preceding, rgn;
  // Search for the `e` suffixes.
  rgn = markRegions( s );
  if ( ( /e$/i ).test( s ) ) {
    preceding = s.replace( /e$/, '' );
    return (
              // Found: delete if in R2, or in R1 and not preceded by a short syllable
              ( /e/ ).test( rgn.r2 ) || ( ( /e/ ).test( rgn.r1 ) && !isShort( preceding ) ) ?
              preceding : s
           );
  }
  // Search for the `l` suffixes.
  if ( ( /l$/ ).test( s ) ) {
    rgn = markRegions( s );
    // Found: delete if in R2
    return ( rgn.r2 && ( /l$/ ).test( rgn.r2 ) ? s.replace( ( /ll$/ ), 'l' ) : s );
  }
  // If nothing happens, must return the string!
  return ( s );
}; // step5()

// ## Public functions
// ### stem
/**
 *
 * Stems an inflected `word` using Porter2 stemming algorithm.
 *
 * @param {string} word — word to be stemmed.
 * @return {string} — the stemmed word.
 *
 * @example
 * stem( 'consisting' );
 * // -> consist
 */
return function stem( word ) {
  var str = word.toLowerCase();
  if ( str.length < 3 ) return ( str );
  if ( exceptions1[ str ] ) return ( exceptions1[ str ] );
  str = prelude( str );
  str = step1a( str );

  if ( !rgxException2.test( str ) ) {
    str = step1b( str );
    str = step1c( str );
    str = step2( str );
    str = step3( str );
    str = step4( str );
    str = step5( str );
  }

  str = str.replace( /3/g , 'y' );
  return ( str );
}; // stem()
})();

module.exports = {
  default: SynonymSidebarPlugin,
};