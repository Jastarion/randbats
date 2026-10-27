// Wrapped in an IIFE so none of these helpers leak into the global scope
// (avoids clashing with same-named globals such as getStats in other scripts).
(function () {
  var TOOLTIPMOVE = undefined;
  var TOOLTIPPOKEMON = undefined;
  try { TOOLTIPMOVE = BattleTooltips.prototype.showMoveTooltip; } catch (e) {}
  try { TOOLTIPPOKEMON = BattleTooltips.prototype.showPokemonTooltip; } catch (e) {}

  // Showdown client weather ids -> @smogon/calc weather names
  var CALC_WEATHER = {
    sunnyday: 'Sun',
    raindance: 'Rain',
    sandstorm: 'Sand',
    hail: 'Hail',
    snow: 'Snow',
    snowscape: 'Snow',
    desolateland: 'Harsh Sunshine',
    primordialsea: 'Heavy Rain',
    deltastream: 'Strong Winds'
  };

  var CALC_TERRAINS = ['Electric', 'Grassy', 'Misty', 'Psychic'];

  // Resolves the key used to look a species up in the randbats DATA tables
  function getSpeciesId(species) {
    var cosmetic = species.cosmeticFormes && species.cosmeticFormes.includes(species.name);
    var id = toID((species.forme === 'Gmax' || cosmetic)
      ? species.baseSpecies : species.battleOnly || species.name);
    if (id.startsWith('pikachu')) id = id.endsWith('gmax') ? 'pikachugmax' : 'pikachu';
    // Maushold-Four is its own species in Showdown's dex, but the randbats data only has 'Maushold'
    if (id === 'mausholdfour') id = 'maushold';
    return id;
  }

  // Builds the EVs / IVs / boosts objects the calc expects
  function getEvsIvsBoosts(stats, data, pokemonBoosts, gen, letsgo, champions) {
    var evs = {};
    var ivs = {};
    var boosts = {};
    pokemonBoosts = pokemonBoosts || {};
    for (var stat in stats) {
      ivs[stat] = 'ivs' in data && stat in data.ivs ? data.ivs[stat] : (gen < 3 ? 30 : 31);
      evs[stat] = 'evs' in data && stat in data.evs ? data.evs[stat] : (gen < 3 ? 255 : letsgo ? 0 : champions ? 11 : 85);
      if (pokemonBoosts[stat]) boosts[stat] = pokemonBoosts[stat];
    }
    return { evs: evs, ivs: ivs, boosts: boosts };
  }

  // Works out which DATA table to use for the current battle (null = unsupported format)
  function getFormatInfo(battle) {
    var format = toID(battle.tier);
    if (!format || !format.includes('random')) return null;

    var gen = Number(format.charAt(3));
    var letsgo = format.includes('letsgo');
    var champions = format.includes('champions');
    var gameType = battle.gameType;

    if (!['singles', 'doubles'].includes(gameType)) {
      format = 'gen' + gen + (champions ? 'champions' : '') + 'randomdoublesbattle';
    } else if (format.includes('monotype') || format.includes('unrated')) {
      format = 'gen' + gen + (champions ? 'champions' : '') + 'randombattle';
    } else if (format.endsWith('blitz')) {
      format = format.slice(0, -5);
    }
    if (!DATA[format]) return null;

    return { format: format, gen: gen, letsgo: letsgo, champions: champions };
  }

  // Looks up the randbats set data for a species at a given level
  function getSetData(info, species, level) {
    var byLevel = DATA[info.format][species.name === 'Zoroark' ? 0 : level];
    if (!byLevel) return null;
    return byLevel[getSpeciesId(species)] || null;
  }

  // ---------------------------------------------------------------------------
  // Opponent's item
  // ---------------------------------------------------------------------------
  // The calc needs the defender's item for Knock Off (x1.5 only if the target holds an item that
  // can be removed), Eviolite, Assault Vest, Air Balloon, resist berries...
  // We can't always know it, so we use, in this order:
  //   1. the item the opponent has revealed
  //   2. no item, if it already lost it (consumed, knocked off, ...)
  //   3. the item the randbats data leaves as the ONLY possibility (or "no item" if that's the only one)
  //   4. otherwise a generic removable placeholder ("mail"): it holds *something*, effects unknown

  function hasHiddenPower(moves) {
    for (var move in moves) {
      if (move.startsWith('Hidden Power')) return true;
    }
    return false;
  }

  // The sets that could belong to this Pokémon (several only when formes share a table)
  function getCandidateSets(sets, clientPokemon) {
    if (sets.length === 1) return sets;
    var forme = clientPokemon.speciesForme || '';
    if (forme.startsWith('Pikachu')) forme = forme.endsWith('Gmax') ? 'Pikachu-Gmax' : 'Pikachu';
    var named = sets.filter(function (set) { return set.name === forme; });
    return named.length ? named : sets;
  }

  // The roles of a set that are still possible given what the opponent has revealed
  // (same filtering the randbats tooltip applies: Tera type and moves seen so far)
  function getPossibleRoles(set, clientPokemon) {
    if (!set.roles) return [set]; // older formats: the set itself is the only "role"
    var possible = [];
    var track = clientPokemon.moveTrack || [];
    outer: for (var name in set.roles) {
      var role = set.roles[name];
      if (clientPokemon.terastallized && role.teraTypes && !role.teraTypes[clientPokemon.terastallized]) continue;
      var moves = role.moves || {};
      for (var i = 0; i < track.length; i++) {
        var move = track[i][0];
        if (move.charAt(0) === '*') continue; // moves copied by Transform
        if (!moves[move] && (move !== 'Hidden Power' || !hasHiddenPower(moves))) continue outer;
      }
      possible.push(role);
    }
    return possible;
  }

  // Every item the opponent can still have: { names: ['Eviolite', ...], none: true if "no item" is possible }
  // Returns null when no role matches what we've seen (then we can't tell anything).
  function getPossibleItems(sets, clientPokemon) {
    var names = {};
    var none = false;
    var found = false;
    var candidates = getCandidateSets(sets, clientPokemon);
    for (var i = 0; i < candidates.length; i++) {
      var roles = getPossibleRoles(candidates[i], clientPokemon);
      for (var j = 0; j < roles.length; j++) {
        found = true;
        var count = 0;
        var items = roles[j].items || {};
        for (var name in items) {
          if (items[name] > 0) {
            names[name] = true;
            count++;
          }
        }
        if (!count) none = true; // role without items = holds nothing
      }
    }
    return found ? { names: Object.keys(names), none: none } : null;
  }

  function getItemName(name) {
    var item = BattleItems[toID(name)];
    return item ? item.name : name;
  }

  // The item to give the defending (opponent's) Pokémon in the calc.
  // Returns { item, options }: item is undefined when it holds nothing; options lists the items it
  // could still have when we can't tell (null = "no item"), used to show "If Assault Vest: ..." lines.
  function getDefenderItem(info, clientPokemon, sets) {
    if (info.gen < 2) return { item: undefined, options: [] }; // no held items before gen 2

    // 1. Revealed. '(mail)' / '(exists)' are team preview placeholders, not real items.
    var item = clientPokemon.item;
    if (item && item.charAt(0) !== '(') return { item: getItemName(item), options: [] };

    // 2. Had one, but it was consumed / knocked off / stolen...
    if (clientPokemon.prevItem || (clientPokemon.volatiles && clientPokemon.volatiles['itemremoved'])) {
      return { item: undefined, options: [] };
    }

    // 3. Only one possibility left in the randbats data
    var possible = getPossibleItems(sets, clientPokemon);
    if (possible) {
      if (possible.names.length === 1 && !possible.none) return { item: getItemName(possible.names[0]), options: [] };
      if (possible.names.length === 0 && possible.none) return { item: undefined, options: [] };
      var options = possible.names.map(getItemName);
      if (possible.none) options.push(null);
      return { item: "mail", options: options };
    }

    // 4. Unknown: assume some removable item
    return { item: "mail", options: [] };
  }

  // ---------------------------------------------------------------------------
  // Opponent's ability
  // ---------------------------------------------------------------------------
  // Same idea as the item: the calc needs it for Levitate, Volt Absorb, Thick Fat, Multiscale,
  // Fur Coat, Fluffy, Well-Baked Body, Solid Rock... We use, in this order:
  //   1. the ability the opponent has revealed
  //   2. the ability the randbats data leaves as the ONLY possibility
  //   3. otherwise a neutral ability with no effect on damage. (If we passed nothing, the calc would
  //      silently assume the species' FIRST listed ability, which is an arbitrary guess: right for
  //      Azelf's Levitate, wrong for Dragonite whose first slot is Inner Focus, not Multiscale.)
  var NEUTRAL_ABILITY = 'Pressure';

  // Every ability the opponent can still have (names)
  function getPossibleAbilities(sets, clientPokemon) {
    var names = {};
    var candidates = getCandidateSets(sets, clientPokemon);
    for (var i = 0; i < candidates.length; i++) {
      var roles = getPossibleRoles(candidates[i], clientPokemon);
      for (var j = 0; j < roles.length; j++) {
        var abilities = roles[j].abilities || {};
        for (var name in abilities) {
          if (abilities[name] > 0) names[name] = true;
        }
      }
    }
    return Object.keys(names);
  }

  // The ability to give the defending (opponent's) Pokémon in the calc.
  // Returns { ability, options }: options lists the abilities it could still have when we can't tell,
  // used to show "If Multiscale: ..." lines.
  function getDefenderAbility(info, battle, clientPokemon, sets) {
    if (info.gen < 3) return { ability: undefined, options: [] }; // no abilities before gen 3

    // 1. Revealed. effectiveAbility() already returns '' if it's suppressed (Gastro Acid,
    //    Neutralizing Gas...) unless the ability can't be suppressed, and for fainted Pokémon.
    var revealed = clientPokemon.effectiveAbility ? clientPokemon.effectiveAbility() : (clientPokemon.ability || '');
    if (revealed && revealed.charAt(0) !== '(') return { ability: revealed, options: [] };

    // Currently suppressed (Gastro Acid / Neutralizing Gas), except unsuppressable abilities?
    var suppressionOn = (clientPokemon.volatiles && clientPokemon.volatiles['gastroacid']) ||
      (battle.ngasActive && battle.ngasActive());
    function isSuppressed(ability) {
      if (!suppressionOn) return false;
      var data = battle.dex && battle.dex.abilities && battle.dex.abilities.get(ability);
      return !data || !data.flags || !data.flags['cantsuppress'];
    }

    // A transformed Pokémon has the target's ability. If the target is one of my Pokémon we know it;
    // abilities that can't be copied (Wonder Guard, Disguise...) stay with the Pokémon.
    var transform = clientPokemon.volatiles && clientPokemon.volatiles['transform'];
    if (transform) {
      var own = transform[1] && getServerPokemon(battle, transform[1]);
      var copied = own && BattleAbilities[toID(own.ability || own.baseAbility)];
      var name = copied && copied.name;
      var data = name && battle.dex && battle.dex.abilities && battle.dex.abilities.get(name);
      if (!name || isSuppressed(name) || (data && data.flags && data.flags['notransform'])) {
        return { ability: NEUTRAL_ABILITY, options: [] };
      }
      return { ability: name, options: [] };
    }

    var possible = getPossibleAbilities(sets, clientPokemon);
    if (!possible.length) return { ability: NEUTRAL_ABILITY, options: [] };

    // 2. Only one possibility left in the randbats data
    if (possible.length === 1) return { ability: isSuppressed(possible[0]) ? NEUTRAL_ABILITY : possible[0], options: [] };

    // 3. Several possibilities: assume none of them matters, and remember which ones could
    return { ability: NEUTRAL_ABILITY, options: possible.filter(function (a) { return !isSuppressed(a); }) };
  }

  // The server data (stats, ability...) of one of MY Pokémon, given its client-side object
  function getServerPokemon(battle, clientPokemon) {
    var list = battle.myPokemon || [];
    for (var i = 0; i < list.length; i++) {
      if (battle.findCorrespondingPokemon && battle.findCorrespondingPokemon(list[i]) === clientPokemon) return list[i];
    }
    return null;
  }

  // The species the Pokémon currently IS for battle purposes. The client keeps the original species in
  // `speciesForme` and records temporary formes in a volatile, which is how Transform (Ditto), Stance
  // Change (Aegislash-Blade), Zen Mode, Shields Down... show up. Falls back to `baseSpecies`.
  function getBattleSpecies(info, clientPokemon, baseSpecies) {
    var forme = clientPokemon.getSpeciesForme ? clientPokemon.getSpeciesForme() : clientPokemon.speciesForme;
    if (!forme || forme === clientPokemon.speciesForme || /-Gmax$/.test(forme)) return baseSpecies;
    var species = Dex.species.get(forme);
    if (!species) return baseSpecies;
    var known = calc.Generations.get(info.gen).species.get(toID(species.name));
    return known ? species : baseSpecies;
  }

  // Typing to force on the defender when it differs from its species' own: Transform copies the target's
  // types, and Soak, Burn Up, Forest's Curse... change them. The calc only has two type slots, and a single
  // type has to be written as [type, '???'] (repeating it would count the type twice).
  function getTypeOverride(clientPokemon) {
    var volatiles = clientPokemon.volatiles || {};
    if (!volatiles['typechange'] && !volatiles['typeadd']) return undefined;
    if (!clientPokemon.getTypeList) return undefined;
    // preterastallized = true: the calc applies Terastallization itself, from teraType
    var types = clientPokemon.getTypeList(undefined, true).slice(0, 2);
    if (!types.length) return undefined;
    return types.length === 1 ? [types[0], '???'] : types;
  }

  // Everything the calc needs to know about the opponent's active Pokémon (the defender).
  // `speciesEnemy` / `dataEnemy` are the Pokémon's own species and randbats data.
  function buildDefender(info, battle, enemy, speciesEnemy, dataEnemy) {
    var item = getDefenderItem(info, enemy, dataEnemy);
    var ability = getDefenderAbility(info, battle, enemy, dataEnemy);
    var defender = {
      species: getBattleSpecies(info, enemy, speciesEnemy),
      set: dataEnemy,
      item: item.item,
      itemOptions: item.options,
      ability: ability.ability,
      abilityOptions: ability.options,
      boosts: enemy.boosts,
      teraType: getTeraType(enemy.terastallized),
      status: getCalcStatus(enemy),
      hpFraction: getHpFraction(enemy),
      types: getTypeOverride(enemy)
    };

    // Transform (Ditto, Imposter): it takes the target's types, ability and stats (all but HP), at the
    // TARGET's level. Its item, status and HP stay its own, so the damage % uses Ditto's HP.
    var transform = enemy.volatiles && enemy.volatiles['transform'];
    if (transform && transform[1] && defender.species !== speciesEnemy) {
      var target = transform[1];
      var targetSpecies = Dex.species.get(target.speciesForme);
      defender.set = (targetSpecies && getSetData(info, targetSpecies, target.level)) || [{ level: target.level }];
      defender.hpFrom = { species: speciesEnemy, set: dataEnemy };
    }
    return defender;
  }

  // My own Pokémon's ability. effectiveAbility() accounts for Gastro Acid / Neutralizing Gas. Never
  // returns nothing (for gen 3+), so the calc can't fall back to the species' first-listed ability.
  function getOwnAbility(info, poke, serverPokemon) {
    if (info.gen < 3) return undefined;
    if (poke && poke.effectiveAbility) return poke.effectiveAbility(serverPokemon) || NEUTRAL_ABILITY;
    var ability = BattleAbilities[toID(serverPokemon.ability || serverPokemon.baseAbility)];
    return (ability && ability.name) || NEUTRAL_ABILITY;
  }

  // ---------------------------------------------------------------------------
  // Disguise / Ice Face: the calc does not model them, so handle them here.
  // The first hit is blocked completely; later hits do the damage the calc computes.
  // ---------------------------------------------------------------------------
  var ABILITY_IGNORING_ABILITIES = ['Mold Breaker', 'Teravolt', 'Turboblaze'];
  var ABILITY_IGNORING_MOVES = [
    'Sunsteel Strike', 'Moongeist Beam', 'Photon Geyser', 'Light That Burns The Sky',
    'Menacing Moonraze Maelstrom', 'Searing Sunraze Smash'
  ];

  // Returns the name of the ability that blocks the first hit, or undefined
  function getFirstHitBlocker(info, attacker, defender, calcMove) {
    if (ABILITY_IGNORING_ABILITIES.indexOf(attacker.ability) !== -1) return undefined;
    if (ABILITY_IGNORING_MOVES.indexOf(calcMove.name) !== -1) return undefined;

    var name = defender.species.name;
    // Intact Mimikyu (not Mimikyu-Busted): blocks any damaging move
    if (defender.ability === 'Disguise' && info.gen >= 7 && /^Mimikyu(-Totem)?$/.test(name)) return 'Disguise';
    // Intact Eiscue (not Eiscue-Noice): blocks physical moves
    if (defender.ability === 'Ice Face' && info.gen >= 8 && name === 'Eiscue' && calcMove.category === 'Physical') return 'Ice Face';
    return undefined;
  }

  function buildField(battle) {
    var mySide = battle.mySide;
    var farSide = battle.farSide;

    // Terrain: pseudoWeather entries look like ['Electric Terrain', ...]
    var terrainEntry = (battle.pseudoWeather || []).find(function (p) {
      return /terrain/i.test(p[0]);
    });
    var terrain = terrainEntry ? terrainEntry[0].replace(/\s*terrain/i, '') : undefined;
    if (CALC_TERRAINS.indexOf(terrain) === -1) terrain = undefined;

    var pseudo = (battle.pseudoWeather || []).map(function (p) { return p[0]; });

    // Air Lock / Cloud Nine switch every weather effect off while they're on the field
    var weather = battle.weather;
    if (battle.abilityActive && battle.abilityActive(['Air Lock', 'Cloud Nine'])) weather = '';

    return new calc.Field({
      // Gravity grounds Levitate / Air Balloon holders, Magic Room switches held items off,
      // Wonder Room swaps Defense and Special Defense.
      isGravity: pseudo.indexOf('Gravity') !== -1,
      isMagicRoom: pseudo.indexOf('Magic Room') !== -1,
      isWonderRoom: pseudo.indexOf('Wonder Room') !== -1,
      attackerSide: {
        isLightScreen: !!(mySide.sideConditions.auroraveil || mySide.sideConditions.lightscreen),
        isReflect: !!(mySide.sideConditions.auroraveil || mySide.sideConditions.reflect)
      },
      defenderSide: {
        isLightScreen: !!(farSide.sideConditions.auroraveil || farSide.sideConditions.lightscreen),
        isReflect: !!(farSide.sideConditions.auroraveil || farSide.sideConditions.reflect)
      },
      weather: CALC_WEATHER[weather],
      terrain: terrain
    });
  }

  // Returns the (capitalized) tera type of a Pokémon that is CURRENTLY terastallized, else undefined.
  // Pass it the client's `terastallized` values only, never `teraType`: the calc treats any
  // teraType it receives as already active, which would wrongly boost Pokémon that haven't terastallized.
  function getTeraType() {
    for (var i = 0; i < arguments.length; i++) {
      var t = arguments[i];
      if (t && typeof t === 'string') return t.charAt(0).toUpperCase() + t.slice(1);
    }
    return undefined;
  }

  var CALC_STATUSES = ['slp', 'psn', 'brn', 'frz', 'par', 'tox'];

  // Status of a client Pokemon / ServerPokemon in the calc's format (undefined = healthy).
  // This is what makes burn's attack drop, Guts, Facade, Hex, Venoshock... work.
  function getCalcStatus(poke) {
    var status = poke && poke.status;
    return CALC_STATUSES.indexOf(status) !== -1 ? status : undefined;
  }

  // Current HP as a fraction of max HP (works for both real HP and percentage HP)
  function getHpFraction(poke) {
    return poke && poke.maxhp ? poke.hp / poke.maxhp : 1;
  }

  // p = { species, set, item, ability, boosts, teraType, status, hpFraction }
  function makePokemon(info, calcGen, p) {
    var stats = getEvsIvsBoosts(p.species.baseStats, p.set[0], p.boosts, info.gen, info.letsgo, info.champions);
    var mon = new calc.Pokemon(calcGen, p.species.name, {
      item: p.item,
      ability: p.ability,
      level: p.set[0].level,
      evs: stats.evs,
      ivs: stats.ivs,
      boosts: stats.boosts,
      // Giving the calc a teraType is what makes it treat the Pokémon as terastallized
      // (Tera STAB x1.333, new defensive typing, Tera Blast...). Gen 9 only.
      teraType: info.gen >= 9 ? p.teraType : undefined,
      status: p.status,
      // Supreme Overlord (+10% per fainted ally) and Last Respects read this
      alliesFainted: p.alliesFainted,
      // Typing that differs from the species' own (Transform, Soak, Burn Up...)
      overrides: p.types ? { types: p.types } : undefined
    });

    // Current HP matters for Blaze/Torrent/Overgrow/Swarm, Eruption, Reversal, Brine...
    if (mon.rawStats && p.hpFraction > 0 && p.hpFraction < 1) {
      mon.originalCurHP = Math.max(1, Math.round(mon.rawStats.hp * p.hpFraction));
    }
    return mon;
  }

  // Returns [min%, max%] of the defender's max HP, or null if it couldn't be computed
  // `hpStat` is the real max HP when it isn't the calc defender's own (a transformed Pokémon keeps its HP)
  function getDamageRange(result, hpStat) {
    var hp = hpStat || parseInt(result["defender"]["stats"]["hp"]);
    var lo, hi;
    if (typeof result.range === 'function') {
      // Handles immunities (damage is a plain 0), multi-hit moves and Parental Bond
      var r = result.range();
      lo = r[0];
      hi = r[1];
    } else {
      var dmg = result["damage"];
      if (typeof dmg === 'number') {
        lo = hi = dmg;
      } else {
        lo = parseInt(dmg[0]);
        hi = parseInt(dmg[dmg.length - 1]);
      }
    }
    var min = Math.round(lo / hp * 1000) / 10;
    var max = Math.round(hi / hp * 1000) / 10;
    if (!isFinite(min) || !isFinite(max)) return null;
    return [min, max];
  }

  // How many hits to calculate for a variable multi-hit move (the 2-5 hit ones: Scale Shot, Bullet Seed,
  // Icicle Spear, Rock Blast...). Returns a list of hit counts to calculate; `undefined` = the calc's default.
  //  - Skill Link: always 5 hits
  //  - Loaded Dice (gen 9): 4 or 5 hits, so we calculate both and show the full spread
  // Moves with a fixed number of hits (Double Hit, Triple Axel, Population Bomb...) are not affected:
  // the calc already assumes every hit lands, which is also what Loaded Dice guarantees for them.
  function getHitCounts(calcGen, info, attacker, moveName) {
    var data = calcGen.moves.get(toID(moveName));
    var multihit = data && data.multihit;
    // Population Bomb always lists 10 hits (its maximum). Loaded Dice makes it hit 4 to 10 times:
    // it removes the per-hit accuracy checks, then takes between 0 and 6 hits off the 10.
    if (multihit === 10 && info.gen >= 9 && attacker.item === 'Loaded Dice') return [4, 10];
    // The 2-5 hit moves (Scale Shot, Bullet Seed, Icicle Spear, Rock Blast, Comet Punch...)
    if (!Array.isArray(multihit) || multihit[0] !== 2 || multihit[1] !== 5) return [undefined];
    if (attacker.ability === 'Skill Link') return [5];
    if (info.gen >= 9 && attacker.item === 'Loaded Dice') return [4, 5];
    return [undefined];
  }

  // How many Pokémon of a side have fainted (Supreme Overlord, Last Respects)
  function getFaintedCount(side) {
    var count = 0;
    var list = (side && side.pokemon) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].fainted) count++;
    }
    return count;
  }

  // Stockpile layers (0-3), which the client tracks as the volatiles stockpile1 / stockpile2 / stockpile3
  function getStockpileLayers(poke) {
    var volatiles = (poke && poke.volatiles) || {};
    if (volatiles['stockpile3']) return 3;
    if (volatiles['stockpile2']) return 2;
    return volatiles['stockpile1'] ? 1 : 0;
  }

  // Does this calc scale Last Respects with the number of fainted allies on its own? (Newer builds do;
  // the one bundled with the extension doesn't.) Found out once per generation by trying it.
  var NATIVE_FAINTED = {};
  function calcScalesWithFainted(calcGen) {
    var key = calcGen.num;
    if (!(key in NATIVE_FAINTED)) {
      var native = false;
      try {
        var run = function (fainted) {
          var attacker = new calc.Pokemon(calcGen, 'Annihilape', { level: 100, alliesFainted: fainted });
          var defender = new calc.Pokemon(calcGen, 'Gengar', { level: 100 });
          return calc.calculate(calcGen, attacker, defender, new calc.Move(calcGen, 'Last Respects'), new calc.Field()).range()[1];
        };
        native = run(3) > run(0);
      } catch (e) {}
      NATIVE_FAINTED[key] = native;
    }
    return NATIVE_FAINTED[key];
  }

  // Base power the calc can't work out by itself: Last Respects (50 + 50 per fainted ally) and Spit Up
  // (100 per Stockpile layer). Returns { bp, tag } or null.
  function getBasePowerOverride(calcGen, attacker, moveName) {
    var id = toID(moveName);
    if (id === 'lastrespects' && !calcScalesWithFainted(calcGen)) {
      var fainted = attacker.alliesFainted || 0;
      return { bp: 50 + 50 * fainted, tag: fainted + ' fainted' };
    }
    if (id === 'spitup' && attacker.stockpile) {
      return { bp: 100 * attacker.stockpile, tag: 'Stockpile x' + attacker.stockpile };
    }
    return null;
  }

  // One calculation; `hits` is undefined for the calc's default.
  // Returns { range: [min, max], note, tags } (tags: short labels for modifiers worth showing).
  function calcOnce(battle, info, calcGen, attacker, defender, moveName, hits) {
    var moveData = calcGen.moves.get(toID(moveName));
    var tags = [];

    // Base power the calc doesn't know about
    var override = getBasePowerOverride(calcGen, attacker, moveName);
    var bp = override ? override.bp : undefined;
    if (override && override.tag) tags.push(override.tag);

    // Charge (the move, or Electromorphosis / Wind Power) doubles the power of the next Electric move.
    // The bundled calc has no logic for it, so double the base power; moves whose power the calc works
    // out itself (Electro Ball...) get the result doubled instead.
    var chargeMultiplier = 1;
    if (attacker.charged && moveData && moveData.type === 'Electric') {
      tags.push('Charged');
      var base = bp || moveData.basePower;
      if (base > 0) bp = base * 2;
      else chargeMultiplier = 2;
    }

    if (attacker.ability === 'Supreme Overlord' && attacker.alliesFainted) {
      tags.push('Supreme Overlord: ' + attacker.alliesFainted + ' fainted');
    }
    var options = {};
    if (hits) options.hits = hits;
    if (bp) options.overrides = { basePower: bp };
    var calcMove = new calc.Move(calcGen, moveName, hits || bp ? options : undefined);
    var result = calc.calculate(
      calcGen,
      makePokemon(info, calcGen, attacker),
      makePokemon(info, calcGen, defender),
      calcMove,
      buildField(battle)
    );
    console.debug(result);
    var hpStat = defender.hpFrom ? makePokemon(info, calcGen, defender.hpFrom).stats.hp : undefined;
    var range = getDamageRange(result, hpStat);
    if (!range) return null;
    if (chargeMultiplier !== 1) {
      range = [Math.round(range[0] * chargeMultiplier * 10) / 10, Math.round(range[1] * chargeMultiplier * 10) / 10];
    }

    var blocker = getFirstHitBlocker(info, attacker, defender, calcMove);
    if (blocker) {
      var total = calcMove.hits > 1 ? calcMove.hits : 1;
      if (total === 1) {
        // Blocked entirely; the calc's number is what the NEXT hit would do
        return { range: [0, 0], note: blocker + ', then ' + range[0] + '% - ' + range[1] + '%', tags: tags };
      }
      var keep = (total - 1) / total; // only the first of the hits is blocked
      return {
        range: [Math.round(range[0] * keep * 10) / 10, Math.round(range[1] * keep * 10) / 10],
        note: 'first hit blocked by ' + blocker,
        tags: tags
      };
    }
    return { range: range, note: undefined, tags: tags };
  }

  // Returns [min%, max%, note?] or null. `note` explains a special case, e.g. "Disguise" or "4-5 hits".
  function calcMoveRange(battle, info, attacker, defender, moveName) {
    var calcGen = calc.Generations.get(info.gen);
    var counts = getHitCounts(calcGen, info, attacker, moveName);

    var min = Infinity;
    var max = -Infinity;
    var blockNote;
    var tags = [];
    for (var i = 0; i < counts.length; i++) {
      var one = calcOnce(battle, info, calcGen, attacker, defender, moveName, counts[i]);
      if (!one) return null;
      min = Math.min(min, one.range[0]);
      max = Math.max(max, one.range[1]);
      blockNote = blockNote || one.note;
      tags = one.tags;
    }

    var notes = [];
    if (counts.length > 1) notes.push(counts[0] + '-' + counts[counts.length - 1] + ' hits');
    for (var t = 0; t < tags.length; t++) notes.push(tags[t]);
    if (blockNote) notes.push(blockNote);
    return [min, max, notes.length ? notes.join('; ') : undefined];
  }

  // The normal calculation, plus what the move would do if the opponent turns out to have one of the
  // abilities / items it might still have. Only the alternatives that change the result are kept
  // (alternatives with the same result are merged), so they only show up when they matter.
  // Returns { range, alternatives: [{ labels: [...], range }] } or null.
  function calcMoveWithAlternatives(battle, info, attacker, defender, moveName) {
    var range = calcMoveRange(battle, info, attacker, defender, moveName);
    if (!range) return null;

    var groups = [];
    function consider(label, change) {
      var variant = {};
      for (var key in defender) variant[key] = defender[key];
      for (var changed in change) variant[changed] = change[changed];
      var other;
      try {
        other = calcMoveRange(battle, info, attacker, variant, moveName);
      } catch (e) {
        return;
      }
      if (!other || (other[0] === range[0] && other[1] === range[1])) return;
      // Eviolite always gets its own line (it would otherwise merge with an Assault Vest line on special moves)
      for (var i = 0; i < groups.length; i++) {
        var sameRange = groups[i].range[0] === other[0] && groups[i].range[1] === other[1];
        var eviolite = label === 'Eviolite' || groups[i].labels.indexOf('Eviolite') !== -1;
        if (sameRange && !eviolite) {
          groups[i].labels.push(label);
          return;
        }
      }
      groups.push({ labels: [label], range: other });
    }

    (defender.abilityOptions || []).forEach(function (ability) {
      // A "0% if Bulletproof" line is only worth showing once we know it has it (then the main number is 0%)
      if (ability === 'Bulletproof') return;
      consider(ability, { ability: ability });
    });
    (defender.itemOptions || []).forEach(function (item) {
      consider(item === null ? 'no item' : item, { item: item === null ? undefined : item });
    });
    // At most 3 lines, except that an Eviolite line is never dropped
    var shown = groups.slice(0, 3);
    groups.slice(3).forEach(function (group) {
      if (group.labels.indexOf('Eviolite') !== -1) shown.push(group);
    });
    return { range: range, alternatives: shown };
  }

  // "a% - b%" plus the optional note in small print
  function formatRange(range) {
    return range[0] + '% - ' + range[1] + '%' + (range[2] ? ' <small>(' + range[2] + ')</small>' : '');
  }

  // ---------------------------------------------------------------------------
  // Move tooltip (hovering a move button for the Pokémon that is out)
  // ---------------------------------------------------------------------------
  if (TOOLTIPMOVE) {
    BattleTooltips.prototype.showMoveTooltip = function (clientMove, serverMove, clientPokemon, serverPokemon) {
      var original = TOOLTIPMOVE.apply(this, arguments);
      try {
        // Skip status moves / moves with no base power (Spit Up has none until Stockpile gives it some)
        var spitUp = toID(clientMove.name) === 'spitup';
        if (!spitUp && (clientMove.basePower == 0 || clientMove.basePower == null)) return original;
        if (!serverPokemon) return original;

        var battle = this.battle;
        var enemy = battle.farSide.active[0];
        var me = battle.mySide.active[0];
        if (!enemy || !me) return original;
        if (spitUp && !getStockpileLayers(me)) return original; // Spit Up fails without Stockpile

        var info = getFormatInfo(battle);
        if (!info) return original;

        var speciesEnemy = Dex.species.get(enemy.speciesForme);
        if (!speciesEnemy) return original;
        var speciesMe = Dex.species.get(me.speciesForme);
        if (!speciesMe) return original;

        var dataEnemy = getSetData(info, speciesEnemy, enemy.level);
        if (!dataEnemy) return original;
        var dataMe = getSetData(info, speciesMe, me.level);
        if (!dataMe) return original;

        var calculated = calcMoveWithAlternatives(
          battle, info,
          {
            species: speciesMe,
            set: dataMe,
            item: BattleItems[toID(serverPokemon.item)]?.name,
            ability: getOwnAbility(info, me, serverPokemon),
            boosts: clientPokemon && clientPokemon.boosts,
            teraType: getTeraType(clientPokemon && clientPokemon.terastallized, me.terastallized, serverPokemon.terastallized),
            status: getCalcStatus(me),
            hpFraction: getHpFraction(me),
            alliesFainted: getFaintedCount(battle.mySide),
            charged: !!(me.volatiles && me.volatiles['charge']),
            stockpile: getStockpileLayers(me)
          },
          buildDefender(info, battle, enemy, speciesEnemy, dataEnemy),
          clientMove.name
        );
        if (!calculated) return original;

        /*
        TODO: dynamax and tera
        var bp = clientMove.basePower;
        if(serverMove === 'maxmove'){
          clientMove.basePower = clientMove.maxMove.basePower;
          buf += getItemModi(statsMe,statsEnemy,dataEnemy, dataMe, serverPokemon, me, enemy, this.getPokemonTypes(me), this.getPokemonTypes(enemy),clientMove,this.battle, true)
          clientMove.basePower = bp;
        }
        else{
          buf += getItemModi(statsMe,statsEnemy,dataEnemy, dataMe, serverPokemon, me, enemy, this.getPokemonTypes(me), this.getPokemonTypes(enemy),clientMove,this.battle, false)
        }
        */

        var buf = original;
        buf += '<div style="border-top: 1px solid #888; background: #dedede">';
        buf += '<p><small>Damage:</small> ' + formatRange(calculated.range) + ' </p>';
        calculated.alternatives.forEach(function (alt) {
          buf += '<p><small>If ' + alt.labels.join(' / ') + ':</small> ' + formatRange(alt.range) + ' </p>';
        });
        buf += '</div>';
        return buf;
      } catch (e) {
        console.debug(e);
        return original;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Pokémon tooltip (hovering a team icon): damage for each move of one of my
  // Pokémon that is NOT out, against the opponent's current active Pokémon.
  // Added right after the moves list.
  // ---------------------------------------------------------------------------
  if (TOOLTIPPOKEMON) {
    BattleTooltips.prototype.showPokemonTooltip = function (clientPokemon, serverPokemon, isActive) {
      var original = TOOLTIPPOKEMON.apply(this, arguments);
      try {
        // Only my own Pokémon (their moves are known) that are not currently out.
        // The Pokémon that is out already gets the calc on its move tooltips.
        if (!serverPokemon || isActive || serverPokemon.active) return original;
        if (!serverPokemon.moves || !serverPokemon.moves.length) return original;

        var battle = this.battle;
        var enemy = battle.farSide.active[0];
        if (!enemy) return original;

        var info = getFormatInfo(battle);
        if (!info) return original;

        var speciesEnemy = Dex.species.get(enemy.speciesForme);
        if (!speciesEnemy) return original;
        var speciesMe = Dex.species.get(serverPokemon.speciesForme || (clientPokemon && clientPokemon.speciesForme));
        if (!speciesMe) return original;

        var dataEnemy = getSetData(info, speciesEnemy, enemy.level);
        if (!dataEnemy) return original;
        var dataMe = getSetData(info, speciesMe, serverPokemon.level);
        if (!dataMe) return original;

        var attacker = {
          species: speciesMe,
          set: dataMe,
          item: BattleItems[toID(serverPokemon.item)]?.name,
          ability: getOwnAbility(info, null, serverPokemon),
          // A Pokémon that terastallized earlier stays terastallized after switching out
          teraType: getTeraType(serverPokemon.terastallized, clientPokemon && clientPokemon.terastallized),
          status: getCalcStatus(serverPokemon),
          hpFraction: getHpFraction(serverPokemon),
          alliesFainted: getFaintedCount(battle.mySide)
        };
        var defender = buildDefender(info, battle, enemy, speciesEnemy, dataEnemy);

        var rows = '';
        var hasDamage = false;
        for (var i = 0; i < serverPokemon.moves.length; i++) {
          var move = Dex.moves.get(serverPokemon.moves[i]);
          if (!move || !move.exists) continue;

          var line = '&#8226; ' + move.name;
          // Status moves and moves with no base power are listed without a number
          if (move.basePower && move.category !== 'Status') {
            try {
              var calculated = calcMoveWithAlternatives(battle, info, attacker, defender, move.name);
              if (calculated) {
                line += ': ' + formatRange(calculated.range);
                calculated.alternatives.forEach(function (alt) {
                  line += '<br />&nbsp;&nbsp;<small>If ' + alt.labels.join(' / ') + ':</small> ' + formatRange(alt.range);
                });
                hasDamage = true;
              } else {
                line += ': &mdash;';
              }
            } catch (e) {
              console.debug(e);
            }
          }
          rows += line + '<br />';
        }
        if (!hasDamage) return original;

        var block = '<div style="border-top: 1px solid #888; background: #dedede">' +
          '<p class="section"><small>Damage vs ' + defender.species.name + ':</small><br />' + rows + '</p>' +
          '</div>';

        // Insert inside the tooltip, right after the moves (before the closing tags)
        var end = /<\/div>\s*<\/div>\s*$/.exec(original);
        if (end) return original.slice(0, end.index) + block + original.slice(end.index);
        return original + block;
      } catch (e) {
        console.debug(e);
        return original;
      }
    };
  }
})();
