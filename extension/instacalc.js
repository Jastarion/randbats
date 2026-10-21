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

  function buildField(battle) {
    var mySide = battle.mySide;
    var farSide = battle.farSide;

    // Terrain: pseudoWeather entries look like ['Electric Terrain', ...]
    var terrainEntry = (battle.pseudoWeather || []).find(function (p) {
      return /terrain/i.test(p[0]);
    });
    var terrain = terrainEntry ? terrainEntry[0].replace(/\s*terrain/i, '') : undefined;
    if (CALC_TERRAINS.indexOf(terrain) === -1) terrain = undefined;

    return new calc.Field({
      attackerSide: {
        isLightScreen: !!(mySide.sideConditions.auroraveil || mySide.sideConditions.lightscreen),
        isReflect: !!(mySide.sideConditions.auroraveil || mySide.sideConditions.reflect)
      },
      defenderSide: {
        isLightScreen: !!(farSide.sideConditions.auroraveil || farSide.sideConditions.lightscreen),
        isReflect: !!(farSide.sideConditions.auroraveil || farSide.sideConditions.reflect)
      },
      weather: CALC_WEATHER[battle.weather],
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
      status: p.status
    });

    // Current HP matters for Blaze/Torrent/Overgrow/Swarm, Eruption, Reversal, Brine...
    if (mon.rawStats && p.hpFraction > 0 && p.hpFraction < 1) {
      mon.originalCurHP = Math.max(1, Math.round(mon.rawStats.hp * p.hpFraction));
    }
    return mon;
  }

  // Returns [min%, max%] of the defender's max HP, or null if it couldn't be computed
  function getDamageRange(result) {
    var hp = parseInt(result["defender"]["stats"]["hp"]);
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

  function calcMoveRange(battle, info, attacker, defender, moveName) {
    var calcGen = calc.Generations.get(info.gen);
    var result = calc.calculate(
      calcGen,
      makePokemon(info, calcGen, attacker),
      makePokemon(info, calcGen, defender),
      new calc.Move(calcGen, moveName),
      buildField(battle)
    );
    console.debug(result);
    return getDamageRange(result);
  }

  // ---------------------------------------------------------------------------
  // Move tooltip (hovering a move button for the Pokémon that is out)
  // ---------------------------------------------------------------------------
  if (TOOLTIPMOVE) {
    BattleTooltips.prototype.showMoveTooltip = function (clientMove, serverMove, clientPokemon, serverPokemon) {
      var original = TOOLTIPMOVE.apply(this, arguments);
      try {
        // Skip status moves / moves with no base power
        if (clientMove.basePower == 0 || clientMove.basePower == null) return original;
        if (!serverPokemon) return original;

        var battle = this.battle;
        var enemy = battle.farSide.active[0];
        var me = battle.mySide.active[0];
        if (!enemy || !me) return original;

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

        var range = calcMoveRange(
          battle, info,
          {
            species: speciesMe,
            set: dataMe,
            item: BattleItems[toID(serverPokemon.item)]?.name,
            ability: BattleAbilities[toID(serverPokemon.ability || serverPokemon.baseAbility)]?.name,
            boosts: clientPokemon && clientPokemon.boosts,
            teraType: getTeraType(clientPokemon && clientPokemon.terastallized, me.terastallized, serverPokemon.terastallized),
            status: getCalcStatus(me),
            hpFraction: getHpFraction(me)
          },
          {
            species: speciesEnemy,
            set: dataEnemy,
            item: "mail",
            boosts: enemy.boosts,
            teraType: getTeraType(enemy.terastallized),
            status: getCalcStatus(enemy),
            hpFraction: getHpFraction(enemy)
          },
          clientMove.name
        );
        if (!range) return original;

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
        buf += '<p><small>Damage:</small> ' + range[0] + '% - ' + range[1] + '% </p>';
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
          ability: BattleAbilities[toID(serverPokemon.ability || serverPokemon.baseAbility)]?.name,
          // A Pokémon that terastallized earlier stays terastallized after switching out
          teraType: getTeraType(serverPokemon.terastallized, clientPokemon && clientPokemon.terastallized),
          status: getCalcStatus(serverPokemon),
          hpFraction: getHpFraction(serverPokemon)
        };
        var defender = {
          species: speciesEnemy,
          set: dataEnemy,
          item: "mail",
          boosts: enemy.boosts,
          teraType: getTeraType(enemy.terastallized),
          status: getCalcStatus(enemy),
          hpFraction: getHpFraction(enemy)
        };

        var rows = '';
        var hasDamage = false;
        for (var i = 0; i < serverPokemon.moves.length; i++) {
          var move = Dex.moves.get(serverPokemon.moves[i]);
          if (!move || !move.exists) continue;

          var line = '&#8226; ' + move.name;
          // Status moves and moves with no base power are listed without a number
          if (move.basePower && move.category !== 'Status') {
            try {
              var range = calcMoveRange(battle, info, attacker, defender, move.name);
              if (range) {
                line += ': ' + range[0] + '% - ' + range[1] + '%';
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
          '<p class="section"><small>Damage vs ' + speciesEnemy.name + ':</small><br />' + rows + '</p>' +
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
