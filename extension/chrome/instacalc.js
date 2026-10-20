var TOOLTIPMOVE = undefined;
try { TOOLTIPMOVE = BattleTooltips.prototype.showMoveTooltip; } catch (e) {}

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
function getStats(stats, data, pokemonBoosts, gen, letsgo, champions) {
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

if (TOOLTIPMOVE) {
  BattleTooltips.prototype.showMoveTooltip = function (clientMove, serverMove, clientPokemon, serverPokemon) {
    var original = TOOLTIPMOVE.apply(this, arguments);
    try {
      // Skip status moves / moves with no base power
      if (clientMove.basePower == 0 || clientMove.basePower == null) {
        return original;
      }
      if (!serverPokemon) return original;

      var farSide = this.battle.farSide;
      var mySide = this.battle.mySide;
      var enemy = farSide.active[0];
      var me = mySide.active[0];
      if (!enemy || !me) return original;

      var format = toID(this.battle.tier);
      if (!format || !format.includes('random')) return original;

      var speciesEnemy = Dex.species.get(enemy.speciesForme);
      if (!speciesEnemy) return original;
      var speciesMe = Dex.species.get(me.speciesForme);
      if (!speciesMe) return original;

      var gen = Number(format.charAt(3));
      var letsgo = format.includes('letsgo');
      var champions = format.includes('champions');
      var gameType = this.battle.gameType;

      if (!['singles', 'doubles'].includes(gameType)) {
        format = 'gen' + gen + (champions ? 'champions' : '') + 'randomdoublesbattle';
      } else if (format.includes('monotype') || format.includes('unrated')) {
        format = 'gen' + gen + (champions ? 'champions' : '') + 'randombattle';
      } else if (format.endsWith('blitz')) {
        format = format.slice(0, -5);
      }
      if (!DATA[format]) return original;

      // Enemy data
      var dataEnemy = DATA[format][speciesEnemy.name === 'Zoroark' ? 0 : enemy.level];
      if (!dataEnemy) return original;
      dataEnemy = dataEnemy[getSpeciesId(speciesEnemy)];
      if (!dataEnemy) return original;

      // My data
      var dataMe = DATA[format][speciesMe.name === 'Zoroark' ? 0 : me.level];
      if (!dataMe) return original;
      dataMe = dataMe[getSpeciesId(speciesMe)];
      if (!dataMe) return original;

      var buf = original;

      var calcGen = calc.Generations.get(gen);

      var statsMe = getStats(speciesMe.baseStats, dataMe[0], clientPokemon.boosts, gen, letsgo, champions);
      var statsEnemy = getStats(speciesEnemy.baseStats, dataEnemy[0], enemy.boosts, gen, letsgo, champions);

      // Terrain: pseudoWeather entries look like ['Electric Terrain', ...]
      var terrainEntry = (this.battle.pseudoWeather || []).find(function (p) {
        return /terrain/i.test(p[0]);
      });
      var terrain = terrainEntry ? terrainEntry[0].replace(/\s*terrain/i, '') : undefined;
      if (CALC_TERRAINS.indexOf(terrain) === -1) terrain = undefined;

      var weather = CALC_WEATHER[this.battle.weather];

      var result = calc.calculate(
        calcGen,
        new calc.Pokemon(calcGen, speciesMe.name, {
          item: BattleItems[serverPokemon.item]?.name,
          ability: BattleAbilities[serverPokemon.baseAbility]?.name,
          level: dataMe[0].level,
          evs: statsMe.evs,
          ivs: statsMe.ivs,
          boosts: statsMe.boosts
        }),
        new calc.Pokemon(calcGen, speciesEnemy.name, {
          item: "mail",
          level: dataEnemy[0].level,
          evs: statsEnemy.evs,
          ivs: statsEnemy.ivs,
          boosts: statsEnemy.boosts
        }),
        new calc.Move(calcGen, clientMove.name),
        new calc.Field({
          attackerSide: {
            isLightScreen: !!(mySide.sideConditions.auroraveil || mySide.sideConditions.lightscreen),
            isReflect: !!(mySide.sideConditions.auroraveil || mySide.sideConditions.reflect)
          },
          defenderSide: {
            isLightScreen: !!(farSide.sideConditions.auroraveil || farSide.sideConditions.lightscreen),
            isReflect: !!(farSide.sideConditions.auroraveil || farSide.sideConditions.reflect)
          },
          weather: weather,
          terrain: terrain
        })
      );

      var defenderHp = parseInt(result["defender"]["stats"]["hp"]);
      var dmg = new Array(2);
      dmg[0] = Math.round(parseInt(result["damage"][0]) / defenderHp * 1000) / 10;
      dmg[1] = Math.round(parseInt(result["damage"][result["damage"].length - 1]) / defenderHp * 1000) / 10;
      console.debug(result);

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

      buf += '<div style="border-top: 1px solid #888; background: #dedede">';
      buf += '<p><small>Damage:</small> ' + dmg[0] + '% - ' + dmg[1] + '% </p>';
      buf += '</div>';

      return buf;
    } catch (e) {
      console.debug(e);
      return original;
    }
  };
}
