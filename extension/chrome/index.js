var DATA = {};

var typechartBool = false;

var SUPPORTED = [
  'gen9championsrandombattle', 'gen9championsrandomdoublesbattle',
  'gen9randombattle', 'gen9randomdoublesbattle', 'gen9babyrandombattle',
  'gen8randombattle', 'gen8bdsprandombattle',
  'gen7randombattle', 'gen7letsgorandombattle',
  'gen6randombattle', 'gen5randombattle', 'gen4randombattle', 'gen3randombattle',
  'gen2randombattle', 'gen1randombattle',
];

// Random Battle sets are generated based on battle-only forms which makes disambiguating sets
// difficult sometimes. We first try searching by level as sometimes this is sufficient to
// differentiate and then by base species - if there is only one set then we can return it.
// Otherwise, if the Pokémon is not the base forme and there is only one set for that forme we can
// return that. However, if the Pokémon is still in its base forme we return multiple (labelled)
// sets.

var TOOLTIP = undefined;
try { TOOLTIP = BattleTooltips.prototype.showPokemonTooltip; } catch {}
if (TOOLTIP) {
  for (var format of SUPPORTED) {
    (function (f) {
      var request = new XMLHttpRequest();
      request.addEventListener('load', function() {
        try {
          var data = {};
          var json = JSON.parse(request.responseText);
          for (var name in json) {
            var pokemon = json[name];
            // Zoroark has an actual level but the "Illusion Level Mod" means the server will lie
            // about its level making it difficult to find. Instead we special case things here and
            // below to always just set Zoroark's level to 0 for searching (the actual clientPokemon
            // level gets used for computing stats)
            if (name.startsWith('Zoroark')) pokemon.level = 0;
            data[pokemon.level] = data[pokemon.level] || {};
            // Dex.forGen not important here because we're not looking at stats
            var species = Dex.species.get(name);
            var id = toID(species.forme === 'Gmax'
              ? species.baseSpecies
              : species.battleOnly || species.name);
            data[pokemon.level][id] = data[pokemon.level][id] || [];
            data[pokemon.level][id].push(Object.assign({name: name}, pokemon));
          }
          DATA[f] = data;
        } catch (err) {
          console.error('Unable to load data for ' + f +
            ' - please check to see if your Pokémon Showdown Randbats Tooltip is up to date.');
        }
      });
      request.open('GET', 'https://pkmn.github.io/randbats/data/stats/' + f + '.json');
      request.send(null);
    })(format);
  }

  BattleTooltips.prototype.showPokemonTooltip = function (clientPokemon, serverPokemon) {
    var original = TOOLTIP.apply(this, arguments);
    if (!clientPokemon || serverPokemon) return original;

    var format = toID(this.battle.tier);
    if (!format || !format.includes('random')) return original;

    var gen = Number(format.charAt(3));
    var letsgo = format.includes('letsgo');
    var champions = format.includes('champions');
    var gameType = this.battle.gameType;

    var species = Dex.forGen(gen).species.get(
      clientPokemon.volatiles.formechange
      ? clientPokemon.volatiles.formechange[1]
      : clientPokemon.speciesForme);
    if (!species) return original;

    if (!['singles', 'doubles'].includes(gameType)) {
      format = 'gen' + gen + (champions ? 'champions' : '') + 'randomdoublesbattle';
    } else if (format.includes('monotype') || format.includes('unrated')) {
      format = 'gen' + gen + (champions ? 'champions' : '') + 'randombattle';
    } else if (format.endsWith('blitz')) {
      format = format.slice(0, -5);
    }
    if (!DATA[format]) return original;

    var data = DATA[format][species.baseSpecies === 'Zoroark' ? 0 : clientPokemon.level];
    if (!data) return original;

    var cosmetic = species.cosmeticFormes && species.cosmeticFormes.includes(species.name);
    var id = toID((species.forme === 'Gmax' || cosmetic)
      ? species.baseSpecies : species.battleOnly || species.name);
    if (id.startsWith('pikachu')) id = id.endsWith('gmax') ? 'pikachugmax' : 'pikachu';
    // Maushold-Four is its own species in Showdown's dex, but the randbats data only has 'Maushold'
    if (id === 'mausholdfour') id = 'maushold';
    var forme = cosmetic ? species.baseSpecies : clientPokemon.speciesForme;
    if (forme.startsWith('Pikachu')) forme = forme.endsWith('Gmax') ? 'Pikachu-Gmax' : 'Pikachu';

    var d = data;
    data = data[id];
    if (!data) return original;

    if (id === 'greninja' && 'greninjabond' in d) {
      data = data.concat(d['greninjabond']);
    }

    if (data.length === 1) {
      data[0].level = clientPokemon.level;
      return original + displaySet(gen, gameType, letsgo, champions, species, data[0], undefined, clientPokemon);
    }
    if (toID(forme) !== id) {
      var match = [];
      for (var set of data) {
        set.level = clientPokemon.level;
        if (set.name === forme) {
          match.push(displaySet(gen, gameType, letsgo, champions, species, set, undefined, clientPokemon));
        }
      }
      if (match.length === 1) return original + match[0];
    }
    var buf = original;
    for (var set of data) {
      set.level = clientPokemon.level;
      // Technically different formes will have different base stats, but given at this stage
      // we're still in the base forme we simply use the base forme base stats for everything.
      buf += displaySet(gen, gameType, letsgo, champions, species, set, set.name, clientPokemon);
    }
    return buf;
  }

  function displaySet(gen, gameType, letsgo, champions, species, data, name, clientPokemon) {
    var noHP = true;
    if (data.moves) {
      for (var move in data.moves) {
        if (move.startsWith('Hidden Power')) {
          noHP = false;
          break;
        }
      }
    }

    var buf = '<div style="border-top: 1px solid #888; background: #dedede">';
    if (name) buf += '<p><b>' + name + '</b></p>';

    var multi = !['singles', 'doubles'].includes(gameType);
    if (data.roles) {
      var roles = filter(data.roles, clientPokemon);
      if (!roles.length) return '';
      var i = 0;
      for (var role of roles) {
        buf += (i == 0 ? '<div>' : '<div style="border-top: 1px solid #888;">');
        buf += '<p><span style="text-decoration: underline;">' + role[0] + '</span> ' +
          '<small>(' + Math.round(role[1].weight * 100) + '%)</small>';
          if (gen >= 3 && !letsgo) {
            buf += '<p><small>Abilities:</small> ' + display(role[1].abilities) + '</p>';
          }
          if (gen >= 2 && !(letsgo && !role[1].items)) {
            buf += '<p><small>Items:</small> ' +
              (role[1].items ? display(role[1].items) : '(No Item)') + '</p>';
          }
        if (gen === 9 && 'teraTypes' in role[1]) {
          buf += '<p><small>Tera Types:</small> ' + display(role[1].teraTypes) + '</p>';
        }
        buf += '<p><small>Moves:</small> ' + display(role[1].moves, multi) + '</p>';
        buf += displayStats(gen, letsgo, champions, species, role[1], data.level, noHP, clientPokemon) + '</div>';
        i++;
      }
    } else {
      if (gen >= 3 && !letsgo) {
        buf += '<p><small>Abilities:</small> ' + display(data.abilities) + '</p>';
      }
      if (gen >= 2 && !(letsgo && !data.items)) {
        buf += '<p><small>Items:</small> ' +
          (data.items ? display(data.items) : '(No Item)') + '</p>';
      }
      buf += '<p><small>Moves:</small> ' + display(data.moves, multi) + '</p>';
      buf += displayStats(gen, letsgo, champions, species, data, data.level, noHP, clientPokemon);
    }

    if (typechartBool) {
      try {
        var types = clientPokemon.getTypes ? clientPokemon.getTypes() : species.types;
        var typeEff = ShowdownEnhancedTooltip.getTypeEff(types);
        var multiplierKeys = [4, 2, .5, .25, 0];
        buf += '<p>Weaknesses: <br />';
        multiplierKeys.forEach((multiplierKey) => {
          if (typeEff[multiplierKey].length > 0) {
            var weakTypes = typeEff[multiplierKey].map(effect => effect ? Dex.getTypeIcon(effect) : '').join('');
            buf += `<p>${multiplierKey}x: ${weakTypes}</p>`;
          }
        });
      } catch (e) {
        console.debug(e);
      }
    }

    buf += '</div>';
    return buf;
  }

  // Works out the Pokémon's CURRENT Speed from its randbats base stat plus everything we can
  // actually see: stat stages, paralysis, Tailwind, revealed items, weather / terrain abilities...
  // Mirrors the order of operations of Showdown's own calculateModifiedStats.
  // Returns { value, notes } where notes lists the modifiers that were applied.
  function getEffectiveSpeed(clientPokemon, baseSpeed, data, gen) {
    var battle = clientPokemon.side && clientPokemon.side.battle;
    if (!battle) return null;

    var notes = [];
    var spe = baseSpeed;
    var stage = clientPokemon.boosts && clientPokemon.boosts.spe;
    var paralyzed = clientPokemon.status === 'par';

    // Stat stages
    if (stage) {
      var boostTable = [1, 1.5, 2, 2.5, 3, 3.5, 4];
      if (stage > 0) {
        spe *= boostTable[stage];
      } else {
        if (gen <= 2) boostTable = [1, 100 / 66, 2, 2.5, 100 / 33, 100 / 28, 4];
        spe /= boostTable[-stage];
      }
      spe = Math.floor(spe);
      notes.push((stage > 0 ? '+' : '') + stage);
    }

    // Gen 1-2: only stages and paralysis matter
    if (gen <= 2) {
      if (paralyzed) {
        spe = Math.floor(spe * 0.25);
        notes.push('Paralysis');
      }
      if (gen <= 1 && spe > 999) spe = 999;
      return { value: spe, notes: notes };
    }

    // Ability: use the revealed one, otherwise the only one this set can have
    var ability = '';
    var suppressed = clientPokemon.volatiles['gastroacid'] || (battle.ngasActive && battle.ngasActive());
    if (!suppressed) {
      ability = toID(clientPokemon.effectiveAbility ? clientPokemon.effectiveAbility() : clientPokemon.ability);
      if (!ability && data && data.abilities) {
        var possible = Object.keys(data.abilities).filter(function (a) { return data.abilities[a] > 0; });
        if (possible.length === 1) ability = toID(possible[0]);
      }
    }

    // Item: only if it has been revealed
    var item = toID(clientPokemon.item);
    var speedHalvingEVItems = [
      'machobrace', 'poweranklet', 'powerband', 'powerbelt', 'powerbracer', 'powerlens', 'powerweight',
    ];
    if ((ability === 'klutz' && speedHalvingEVItems.indexOf(item) === -1) ||
        battle.hasPseudoWeather('Magic Room') || clientPokemon.volatiles['embargo']) {
      item = '';
    }

    var weather = battle.weather;
    if (battle.abilityActive && battle.abilityActive(['Air Lock', 'Cloud Nine'])) weather = '';

    var mods = []; // [multiplier, label]
    var species = clientPokemon.getSpecies ? clientPokemon.getSpecies() : null;
    if (species && species.baseSpecies === 'Ditto' && !clientPokemon.volatiles['transform'] && item === 'quickpowder') {
      mods.push([2, 'Quick Powder']);
    }
    if (weather) {
      if (ability === 'sandrush' && weather === 'sandstorm') mods.push([2, 'Sand Rush']);
      if (ability === 'slushrush' && (weather === 'hail' || weather === 'snowscape')) mods.push([2, 'Slush Rush']);
      if (item !== 'utilityumbrella') {
        if (ability === 'chlorophyll' && (weather === 'sunnyday' || weather === 'desolateland')) mods.push([2, 'Chlorophyll']);
        if (ability === 'swiftswim' && (weather === 'raindance' || weather === 'primordialsea')) mods.push([2, 'Swift Swim']);
      }
    }
    if (clientPokemon.volatiles['slowstart']) mods.push([0.5, 'Slow Start']);
    if (ability === 'unburden' && clientPokemon.volatiles['itemremoved'] && !item) mods.push([2, 'Unburden']);
    if (clientPokemon.volatiles['protosynthesisspe'] || clientPokemon.volatiles['quarkdrivespe']) {
      mods.push([1.5, ability === 'quarkdrive' ? 'Quark Drive' : 'Protosynthesis']);
    }
    if (clientPokemon.status && ability === 'quickfeet') mods.push([1.5, 'Quick Feet']);
    if (ability === 'surgesurfer' && battle.hasPseudoWeather('Electric Terrain')) mods.push([2, 'Surge Surfer']);
    if (item === 'choicescarf' && !clientPokemon.volatiles['dynamax']) mods.push([1.5, 'Choice Scarf']);
    if (item === 'ironball' || speedHalvingEVItems.indexOf(item) !== -1) mods.push([0.5, 'Slowing item']);

    // Side conditions of the Pokémon's OWN side
    var sideConditions = (clientPokemon.side && clientPokemon.side.sideConditions) || {};
    if (sideConditions['tailwind']) mods.push([2, 'Tailwind']);
    if (sideConditions['grasspledge']) mods.push([0.25, 'Swamp']);

    var chained = 1;
    for (var i = 0; i < mods.length; i++) {
      chained *= mods[i][0];
      notes.push(mods[i][1]);
    }
    // Chained modifiers round down on 0.5
    spe *= chained;
    spe = spe % 1 > 0.5 ? Math.ceil(spe) : Math.floor(spe);

    // Paralysis is applied last (Quick Feet ignores it)
    if (paralyzed && ability !== 'quickfeet') {
      spe = Math.floor(spe * (gen > 6 ? 0.5 : 0.25));
      notes.push('Paralysis');
    }
    return { value: spe, notes: notes };
  }

  // Each Ruin ability lowers one stat of every OTHER Pokémon on the field by 25% (gen 9)
  var RUIN_ABILITIES = { atk: 'Tablets of Ruin', def: 'Sword of Ruin', spa: 'Vessel of Ruin', spd: 'Beads of Ruin' };

  // Applies a stat stage (-6..+6) to a stat the way Showdown does
  function applyStatStage(value, stage, gen) {
    if (!stage) return value;
    var boostTable = [1, 1.5, 2, 2.5, 3, 3.5, 4];
    if (stage > 0) {
      value *= boostTable[stage];
    } else {
      if (gen <= 2) boostTable = [1, 100 / 66, 2, 2.5, 100 / 33, 100 / 28, 4];
      value /= boostTable[-stage];
    }
    return Math.floor(value);
  }

  function displayStats(gen, letsgo, champions, species, data, level, noHP, clientPokemon) {
    var stats = {};
    for (var stat in species.baseStats) {
      stats[stat] = calcStat(
        gen,
        stat,
        species.baseStats[stat],
        'ivs' in data && stat in data.ivs ? data.ivs[stat] : (gen < 3 ? 30 : 31),
        'evs' in data && stat in data.evs ? data.evs[stat] : (gen < 3 ? 255 : letsgo ? 0 : champions ? 11 : 85),
        level,
        letsgo,
        champions);
    }

    // The Pokémon's CURRENT stats, after what we can actually see: stat stages, the Rock-in-sandstorm
    // Special Defense and Ice-in-snow Defense boosts, and everything that affects Speed (paralysis,
    // Tailwind, abilities...). Same order as Showdown's own calculateModifiedStats: stages, then weather.
    var modified = {};
    var anyModified = false;
    if (clientPokemon) {
      try {
        var battle = clientPokemon.side && clientPokemon.side.battle;
        var weather = battle ? battle.weather : '';
        if (battle && battle.abilityActive && battle.abilityActive(['Air Lock', 'Cloud Nine'])) weather = '';
        var types = clientPokemon.getTypeList ? clientPokemon.getTypeList() : [];
        // This Pokémon's own ability: a Ruin ability doesn't lower its bearer's own stat
        var ownAbility = toID(clientPokemon.effectiveAbility ? clientPokemon.effectiveAbility() : clientPokemon.ability);
        for (var modStat of Dex.statNamesExceptHP) {
          if (gen === 1 && modStat === 'spd') continue;
          var value = stats[modStat];
          if (modStat === 'spe') {
            var eff = getEffectiveSpeed(clientPokemon, stats.spe, data, gen);
            if (eff) value = eff.value;
          } else {
            var stage = clientPokemon.boosts && clientPokemon.boosts[gen === 1 && modStat === 'spa' ? 'spc' : modStat];
            value = applyStatStage(value, stage, gen);
            if (gen >= 4 && weather === 'sandstorm' && modStat === 'spd' && types.indexOf('Rock') !== -1) {
              value = Math.floor(value * 1.5);
            }
            if ((weather === 'snowscape' || weather === 'snow') && modStat === 'def' && types.indexOf('Ice') !== -1) {
              value = Math.floor(value * 1.5);
            }
            // Ruin abilities on the field (mine, or this Pokémon's ally), as Showdown's own code does it
            var ruin = RUIN_ABILITIES[modStat];
            if (ruin && gen >= 9 && ownAbility !== toID(ruin) && battle && battle.abilityActive && battle.abilityActive(ruin)) {
              value = Math.floor(value * 0.75);
            }
            if (gen <= 1 && value > 999) value = 999;
          }
          if (value !== stats[modStat]) {
            modified[modStat] = value;
            anyModified = true;
          }
        }
      } catch (e) {
        console.debug(e);
        modified = {};
        anyModified = false;
      }
    }

    // Same layout Showdown uses for stat modifiers: the normal stat line, then
    // "(After stat modifiers:)" and a second line where changed stats are green / red.
    function statLine(useModified) {
      var line = '<p>';
      for (var statName of Dex.statNamesExceptHP) {
        if (gen === 1 && statName === 'spd') continue;
        var known = gen === 1 || (gen === 2 && noHP) ||
          ('ivs' in data && statName in data.ivs) || ('evs' in data && statName in data.evs);
        var statLabel = gen === 1 && statName === 'spa' ? 'spc' : statName;
        line += statName === 'atk' ? '<small>' : '<small> / ';
        line += '' + BattleTextParser.statShortName(statLabel) + '&nbsp;</small>';
        var italic = !known && (statName === 'atk' || statName === 'spe');
        var shown = '' + stats[statName];
        if (useModified && statName in modified) {
          shown = '<strong class="' + (modified[statName] < stats[statName] ? 'stat-lowered' : 'stat-boosted') + '">' +
            modified[statName] + '</strong>';
        }
        line += (italic ? '<i>' : '') + shown + (italic ? '</i>' : '');
      }
      return line + '</p>';
    }

    var buf = statLine(false);
    if (anyModified) {
      buf += '<p><small>(After stat modifiers:)</small></p>' + statLine(true);
    }
    return buf;
  }

  function compare(a, b) {
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  }

  function filter(roles, clientPokemon) {
    var all = Object.entries(roles);
    if (!clientPokemon) return all;

    var possible = [];
    outer: for (var role of all) {
      if (clientPokemon.terastallized && !role[1].teraTypes[clientPokemon.terastallized]) continue;
      for (var moveslot of clientPokemon.moveTrack) {
        if (!role[1].moves[moveslot[0]] &&
            (moveslot[0] !== 'Hidden Power' || !hasHiddenPower(role[1].moves))) {
          continue outer;
        }
      }
      possible.push(role);
    }
    return possible;
  }

  function hasHiddenPower(moves) {
    for (var move in moves) {
      if (move.startsWith('Hidden Power')) return true;
    }
    return false;
  }

  function display(stats, multi) {
    var buf = [];
    for (var key in stats) {
      if (stats[key] === 0 || (multi && key === 'Ally Switch')) continue;
      buf.push(key + (stats[key] >= 1
        ? '' : ' <small>(' + Math.round(stats[key] * 100) + '%)</small>'));
    }
    return buf.join(', ');
  }

  function tr(num) {
    return num >>> 0
  }

  function calcStat(gen, stat, base, iv, ev, level, letsgo, champions) {
    if (gen < 3) iv = Math.floor(iv / 2) * 2;
    if (stat === 'hp') {
      if (champions) return tr((2 * base + 31 + Math.max(2 * ev - 1, 0)) * level / 100) + level + 10;
      var val = base === 1 ? base : tr(tr(2 * base + iv + tr(ev / 4) + 100) * level / 100 + 10);
      return letsgo ? val + 20 : val;
    } else {
      if (champions) return tr((2 * base + 31 + Math.max(2 * ev - 1, 0)) * level / 100) + 5;
      var val = tr(tr(2 * base + iv + tr(ev / 4)) * level / 100 + 5);
      return letsgo ? tr(val * 102 / 100) + 20 : val;
    }
  }
}