// The built-in category bank, grouped by theme. Hosts can pick from these,
// shuffle a random paper, or type their own.
const CATEGORY_GROUPS = {
  'Places': [
    'Place', 'Country', 'City', 'Dream vacation', 'Beach', 'Island', 'Landmark', 'Place to live',
    'Place to be on a Sunday', 'Shop', 'Mall', 'Hotel', 'Theme park', 'Museum', 'Neighborhood',
    'Place you want to visit', 'Place from childhood', 'First date spot', 'Hiding spot', 'Coffee shop',
  ],
  'Food & drink': [
    'Food', 'Restaurant', 'Fast food place', 'Snack', 'Dessert', 'Breakfast', 'Fruit', 'Vegetable',
    'Drink', 'Hot drink', 'Soda', 'Juice', 'Pizza topping', 'Ice cream flavor', 'Candy', 'Cereal',
    'Sauce', 'Spice', 'Comfort food', 'Last meal', 'Sandwich', 'Chips flavor', 'Cuisine', 'Street food',
  ],
  'Music': [
    'Song', 'Singer', 'Band', 'Rapper', 'Album', 'Music genre', 'Karaoke song', 'Road trip song',
    'Song stuck in your head', 'Workout song', 'Throwback song', 'Concert to see', 'Instrument', 'Ringtone',
  ],
  'Movies & TV': [
    'Movie', 'TV show', 'Cartoon', 'Anime', 'Actor', 'Actress', 'Movie villain', 'Superhero',
    'Disney movie', 'Horror movie', 'Comedy', 'Reality show', 'Netflix series', 'Movie quote',
    'Fictional character', 'Childhood show', 'Movie to rewatch',
  ],
  'Cars & things': [
    'Car', 'Dream car', 'Car brand', 'Car color', 'Motorcycle', 'Phone', 'Phone brand', 'Laptop',
    'Watch', 'Shoe brand', 'Sneaker', 'Clothing brand', 'Perfume', 'Bag', 'Gadget', 'Toy', 'Board game',
  ],
  'Numbers': [
    'Number', 'Lucky number', 'Age you feel', 'Hours of sleep', 'Cups of coffee a day', 'Shoe size',
    'Number of kids you want', 'Dream salary', 'Favorite year', 'Jersey number', 'Day of the month',
    'Number of countries visited', 'Screen time hours', 'Age to retire',
  ],
  'People': [
    'Celebrity', 'Athlete', 'Influencer', 'YouTuber', 'Celebrity crush', 'Historical figure',
    'Comedian', 'Role model', 'Person to have dinner with', 'Cartoon crush', 'Author',
    'Best friend\'s name', 'Teacher you remember',
  ],
  'Sports & games': [
    'Sport', 'Sports team', 'Football club', 'Video game', 'Mobile game', 'Game console',
    'Olympic sport', 'Card game', 'Workout', 'Sport to watch', 'Gym exercise',
  ],
  'All about you': [
    'Color', 'Animal', 'Pet name', 'Season', 'Month', 'Day of the week', 'Holiday', 'Hobby',
    'Dream job', 'Superpower', 'Fear', 'Pet peeve', 'Talent', 'Emoji', 'Word', 'Nickname',
    'Smell', 'Weather', 'Time of day', 'Zodiac sign', 'Font', 'Flower', 'Tree', 'Gemstone',
    'Subject in school', 'App', 'Website', 'Social media', 'Book', 'Language to learn', 'Guilty pleasure',
  ],
  'Wild cards': [
    'Item on a desert island', 'Thing in your bag', 'Last thing you bought', 'Weirdest food you ate',
    'Something you collect', 'Thing you can\'t live without', 'Word you overuse', 'Dance move',
    'Halloween costume', 'Midnight snack', 'Excuse for being late', 'Animal you\'d be',
    'First thing you\'d buy if rich', 'Mythical creature', 'Planet', 'Dinosaur', 'Magic spell', 'Kitchen tool',
  ],
};

const ALL_CATEGORIES = [...new Set(Object.values(CATEGORY_GROUPS).flat())];
const DEFAULT_CATEGORIES = ['Place', 'Song', 'Number', 'Car', 'Food', 'Restaurant'];

function randomCategories(n, exclude = []) {
  const skip = new Set(exclude.map((s) => s.toLowerCase()));
  const pool = ALL_CATEGORIES.filter((c) => !skip.has(c.toLowerCase()));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(1, Math.min(n, 20)));
}

module.exports = { CATEGORY_GROUPS, ALL_CATEGORIES, DEFAULT_CATEGORIES, randomCategories };
