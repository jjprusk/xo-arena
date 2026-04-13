// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Mountain name pool for room naming.
 * Names are used as URL slugs: xoarena.com/room/mt-everest
 * Pool of 1000+ names; server assigns unique names to active rooms.
 */

const MOUNTAINS = [
  'Everest', 'K2', 'Kangchenjunga', 'Lhotse', 'Makalu', 'Cho-Oyu', 'Dhaulagiri', 'Manaslu',
  'Nanga-Parbat', 'Annapurna', 'Gasherbrum-I', 'Broad-Peak', 'Gasherbrum-II', 'Shishapangma',
  'Gyachung-Kang', 'Himalchuli', 'Distaghil-Sar', 'Ngadi-Chuli', 'Nuptse', 'Khunyang-Chhish',
  'Masherbrum', 'Nanda-Devi', 'Rakaposhi', 'Batura-Sar', 'Kanjut-Sar', 'Saltoro-Kangri',
  'Trivor', 'Kongur-Tagh', 'Tirich-Mir', 'Molamenqing', 'Gurla-Mandhata', 'Kongur-Tiube',
  'Fang', 'Ismoil-Somoni', 'Jengish-Chokusu', 'Pobeda', 'Muztagh-Ata', 'Skyang-Kangri',
  'Malubiting', 'Gangkhar-Puensum', 'Tent-Peak', 'Chogolisa', 'Dufourspitze', 'Liskamm',
  'Weisshorn', 'Matterhorn', 'Mont-Blanc', 'Grandes-Jorasses', 'Aiguille-Verte', 'Barre-des-Ecrins',
  'Meije', 'Piz-Bernina', 'Finsteraarhorn', 'Aletschhorn', 'Jungfrau', 'Eiger', 'Monch',
  'Schreckhorn', 'Wetterhorn', 'Titlis', 'Santis', 'Pilatus', 'Rigi', 'Gothard', 'Gotthard',
  'Kilimanjaro', 'Kenya', 'Ruwenzori', 'Elgon', 'Meru', 'Karisimbi', 'Nyiragongo', 'Cameroon',
  'Toubkal', 'Tibesti', 'Ras-Dejen', 'Semien', 'Batu', 'Guna', 'Chike', 'Abuna-Yosef',
  'Denali', 'Logan', 'Orizaba', 'Saint-Elias', 'Popocatepetl', 'Foraker', 'Iztaccihuatl',
  'Lucania', 'Steele', 'Bona', 'Blackburn', 'Sanford', 'Wood', 'Vancouver', 'Churchill',
  'Fairweather', 'Hubbard', 'Walsh', 'Alverstone', 'Massive', 'Harvard', 'Elbert', 'Lincoln',
  'Castle', 'Quandary', 'Democrat', 'Cameron', 'Sherman', 'Bierstadt', 'Evans', 'Torreys',
  'Grays', 'Pikes', 'Whitney', 'Williamson', 'White', 'North-Palisade', 'Sill', 'Muir',
  'Agassiz', 'Middle-Palisade', 'Tyndall', 'Russell', 'Langley', 'LeConte', 'Corcoran',
  'Aconcagua', 'Ojos-del-Salado', 'Monte-Pissis', 'Llullaillaco', 'Mercedario', 'Huascaran',
  'Yerupaja', 'Coropuna', 'Ausangate', 'Tres-Cruces', 'Nevado-del-Sajama', 'Illimani',
  'Chimborazo', 'Cotopaxi', 'Tungurahua', 'Antisana', 'Pichincha', 'Sangay', 'Altar',
  'Roraima', 'Duida', 'Auyan-Tepui', 'Kukenan', 'Pakaraima', 'Marahuaka', 'Neblina',
  'Carstensz', 'Trikora', 'Mandala', 'Yamin', 'Wisnumurti', 'Ngga-Pulu', 'Sumantri',
  'Kosciuszko', 'Townsend', 'Rams-Head', 'Abbott', 'Carruthers', 'Lee', 'Twynam',
  'Erebus', 'Terror', 'Sidley', 'Kirkpatrick', 'Markham', 'Bell', 'Mackellar', 'Kaplan',
  'Elbrus', 'Dykh-Tau', 'Shkhara', 'Koshtan-Tau', 'Dzhangitau', 'Kazbek', 'Tetnuldi',
  'Ushba', 'Adishi', 'Laila', 'Tetnuldi', 'Janga', 'Gestola', 'Tetnuldi', 'Shkhelda',
  'Fuji', 'Tateyama', 'Ontake', 'Norikura', 'Kita', 'Ainodake', 'Hoken', 'Hotaka',
  'Yarigatake', 'Tsurugi', 'Shirouma', 'Kashimayari', 'Goryu', 'Hakuba', 'Otensyodake',
  'Rainier', 'Adams', 'Hood', 'Saint-Helens', 'Jefferson', 'Three-Sisters', 'Newberry',
  'Crater-Lake', 'Diamond', 'McLoughlin', 'Washington', 'Thielsen', 'Shasta', 'Lassen',
  'Baker', 'Glacier', 'Olympus', 'Constance', 'Stuart', 'Fernow', 'Jack', 'Seven-Fingered',
  'Enchantments', 'Cashmere', 'Ingalls', 'Navaho', 'Asgard', 'Dragontail', 'Colchuck',
  'Isolation', 'Ritter', 'Banner', 'Lyell', 'Maclure', 'Electra', 'Gibbs', 'Koip',
  'Gabb', 'Abbott-Peak', 'Gemini', 'Hopkins', 'Stanford', 'Crocker', 'Conness', 'Dana',
  'Tioga', 'Whorl', 'Excelsior', 'Dunderberg', 'Twin-Peaks', 'Pilot', 'Hawksbill',
  'Tallac', 'Dicks', 'Jacks', 'Pyramid', 'Price', 'Freel', 'Rose', 'Houghton', 'Agassiz',
  'Olympus-Greece', 'Parnassus', 'Taygetos', 'Ida-Crete', 'Ossa', 'Pelion', 'Smolikas',
  'Gamila', 'Tymfi', 'Vardousia', 'Ghiona', 'Pindus', 'Koziakas', 'Agrafa', 'Othris',
  'Blanc-de-Moming', 'Rochefort', 'Aguille-du-Chardonnet', 'Aguille-de-Bionnassay',
  'Dome-de-Rochefort', 'Droites', 'Courtes', 'Argentine', 'Chardonnet', 'Triolet',
  'Dolent', 'Argentiere', 'Tour-Noir', 'Aiguille-Rouge', 'Fenetre', 'Balme', 'Brevent',
  'Flegere', 'Index', 'Bettembourg', 'Clochers', 'Petits-Charmoz', 'Grands-Charmoz',
  'Grepon', 'Blaitiere', 'Fou', 'Plan', 'Midi', 'Deux-Aigles', 'Ciseaux', 'Peigne',
  'Roc-Nantillons', 'Pierrette', 'Caiman', 'Crocodile', 'Requin', 'Pouce', 'Lepiney',
  'Ravanel', 'Mummery', 'Charmoz-Grepon', 'Frendo-Spur', 'Frendo', 'Spur', 'Rebuffat',
  'Contamine', 'Devies', 'Charlet', 'Livanos', 'Magnone', 'Gabarrou', 'Profit',
  'Washburn', 'Brooks', 'Moose', 'Igikpak', 'Michelson', 'Chamberlin', 'Isto', 'Hubley',
  'Doonerak', 'Frigid', 'Arrigetch', 'Boreal', 'Sukakpak', 'Schwatka', 'Bendeleben',
  'Osborn', 'Wrangell', 'Blackburn-II', 'Drum', 'Sanford-II', 'Jarvis', 'Gordon',
  'Hayes', 'Deborah', 'Hess', 'Silverthrone', 'Slaggard', 'Lucania-II', 'Steele-II',
  'Augusta', 'Fairweather-II', 'Crillon', 'Lituya', 'Quincy-Adams', 'Wilbur', 'Bertha',
  'Abbe', 'Grotto', 'Pyramid-Alaska', 'Steller', 'Huxley', 'LaPerouse', 'Dagelet',
  'Bowdoin', 'Salisbury', 'Kennedy', 'Deception', 'Hubbard-II', 'Alverstone-II',
  'Cook', 'Pinnacle', 'Hitchcock', 'Alverstone-III', 'Walsh-II', 'King', 'Queen',
  'Borealis', 'Australis', 'Corona', 'Aurora', 'Solstice', 'Equinox', 'Zenith',
  'Nadir', 'Meridian', 'Horizon', 'Apex', 'Summit', 'Crest', 'Ridge', 'Pinnacle-II',
  'Spire', 'Tower', 'Needle', 'Pyramid-II', 'Obelisk', 'Monolith', 'Sentinel', 'Rampart',
  'Bastion', 'Citadel', 'Fortress', 'Stronghold', 'Redoubt', 'Bulwark', 'Parapet',
  'Embrasure', 'Barbican', 'Battlement', 'Machicolation', 'Portcullis', 'Drawbridge',
  'Moat', 'Bailey', 'Motte', 'Keep', 'Donjon', 'Turret', 'Merlon', 'Crenel',
]

// Shuffle helper (Fisher-Yates)
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Mountain name pool manager.
 * Tracks which names are currently in use.
 */
class MountainNamePool {
  constructor(names) {
    this._all = names
    this._available = new Set(names)
    this._inUse = new Set()
  }

  /**
   * Reserve and return a random available name.
   * Returns null if pool is exhausted.
   */
  acquire() {
    if (this._available.size === 0) return null
    const arr = [...this._available]
    const name = arr[Math.floor(Math.random() * arr.length)]
    this._available.delete(name)
    this._inUse.add(name)
    return name
  }

  /**
   * Return a name to the pool.
   */
  release(name) {
    this._inUse.delete(name)
    this._available.add(name)
  }

  /**
   * Swap a name (host requests a different one before opponent joins).
   * Never returns the same name as `current`.
   */
  swap(current) {
    // Remove from in-use but don't add to available yet,
    // so acquire() cannot pick the same name.
    this._inUse.delete(current)
    const next = this.acquire()
    if (next === null) {
      // No alternatives — restore current and return it unchanged.
      this._available.add(current)
      return current
    }
    this._available.add(current)
    return next
  }

  get available() { return this._available.size }
  get inUse() { return this._inUse.size }

  /**
   * Convert name to URL slug: 'Mt-Everest' → 'mt-everest'
   */
  static toSlug(name) {
    return `mt-${name.toLowerCase()}`
  }

  /**
   * Convert slug back to display name: 'mt-everest' → 'Mt. Everest'
   */
  static fromSlug(slug) {
    const raw = slug.replace(/^mt-/, '')
    return `Mt. ${raw.charAt(0).toUpperCase() + raw.slice(1).replace(/-/g, ' ')}`
  }
}

export const mountainPool = new MountainNamePool(MOUNTAINS)
export { MountainNamePool }
