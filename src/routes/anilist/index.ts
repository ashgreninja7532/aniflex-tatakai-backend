import { Hono } from 'hono';

const anilistRouter = new Hono();
const ANILIST_URL = 'https://graphql.anilist.co';

// ==========================================
// GRAPHQL QUERIES (Updated to extraLarge & No Hentai)
// ==========================================

const SEARCH_QUERY = `
query ($id: Int, $page: Int, $perPage: Int, $search: String) {
  Page (page: $page, perPage: $perPage) {
    media (id: $id, search: $search, type: ANIME, isAdult: false) { 
      id title { romaji english native } coverImage { extraLarge } bannerImage description episodes status averageScore genres seasonYear format
    }
  }
}`;

const INFO_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME, isAdult: false) {
    id title { romaji english native } coverImage { extraLarge } bannerImage description episodes status averageScore genres seasonYear format
    startDate { year month day } endDate { year month day }
    studios { edges { node { name isAnimationStudio } } }
    characters(sort: ROLE) {
      edges {
        role
        node { name { full } }
        voiceActors(language: JAPANESE, sort: RELEVANCE) { name { full } image { large } } 
      }
    }
    staff { edges { role node { name { full } image { large } } } }
    relations {
      edges {
        relationType
        node { id title { romaji english native } format type status isAdult coverImage { extraLarge } }
      }
    }
  }
}`;

const ADVANCED_SEARCH_QUERY = `
query (
  $id: Int, $page: Int, $perPage: Int, $search: String,
  $type: MediaType, $format: MediaFormat, $sort: [MediaSort],
  $genres: [String], $year: Int, $status: MediaStatus,
  $season: MediaSeason, $countryOfOrigin: CountryCode
) {
  Page (page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage perPage }
    media (
      id: $id, search: $search, type: $type, format: $format,
      sort: $sort, genre_in: $genres, seasonYear: $year,
      status: $status, season: $season, countryOfOrigin: $countryOfOrigin,
      isAdult: false 
    ) {
      id title { romaji english native } coverImage { extraLarge } format status episodes seasonYear averageScore genres
    }
  }
}`;

const RECENT_EPISODES_QUERY = `
query($page: Int, $perPage: Int, $airingAt_lesser: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total currentPage lastPage hasNextPage perPage }
    airingSchedules(airingAt_lesser: $airingAt_lesser, sort: TIME_DESC) {
      id episode airingAt
      media { id title { romaji english native } coverImage { extraLarge } format status isAdult }
    }
  }
}`;

const GENRES_QUERY = `query { GenreCollection }`;

const SCHEDULE_QUERY = `
query($start: Int, $end: Int, $page: Int) {
  Page(page: $page, perPage: 100) {
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
      id episode airingAt
      media { id title { romaji english native } coverImage { extraLarge } isAdult format status }
    }
  }
}`;

// ==========================================
// HELPER FUNCTION
// ==========================================

const fetchAnilist = async (query: string, variables: any = {}) => {
  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!response.ok) throw new Error("AniList API Error");
  return response.json();
};

// ==========================================
// ROUTES
// ==========================================

// 1. Basic Search
anilistRouter.get('/search', async (c) => {
  const query = c.req.query('q');
  // 🛠️ FIX: Extract the page from the URL, default to 1
  const page = c.req.query('page') || "1"; 
  if (!query) return c.json({ error: "Query 'q' is required" }, 400);

  try {
    // 🛠️ FIX: Pass parseInt(page) to the AniList fetcher instead of hardcoding 1
    const data: any = await fetchAnilist(SEARCH_QUERY, { search: query, page: parseInt(page), perPage: 20 });
    return c.json(data.data.Page.media);
  } catch (err) {
    return c.json({ error: "AniList Search Failed" }, 500);
  }
});

// 2. Info (with Relations & Safe Filtering)
anilistRouter.get('/info/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const data: any = await fetchAnilist(INFO_QUERY, { id: parseInt(id) });
    const media = data.data?.Media;
    
    // If it's an 18+ ID, AniList returns null because we added isAdult: false
    if (!media) return c.json({ error: "Not Found or Content Restricted" }, 404);

    const formatAiringDate = (dateObj: any) => dateObj.year ? `${dateObj.year}-${String(dateObj.month || 1).padStart(2, '0')}-${String(dateObj.day || 1).padStart(2, '0')}` : null;

    const studios: string[] = [];
    const producers: string[] = [];
    media.studios?.edges?.forEach((edge: any) => edge.node.isAnimationStudio ? studios.push(edge.node.name) : producers.push(edge.node.name));

    const targetStaffRoles = ["Original Creator", "Original Story", "Director", "Assistant Director", "Character Design"];
    const staff = media.staff?.edges?.filter((edge: any) => targetStaffRoles.some(targetRole => edge.role.includes(targetRole)))
      .map((edge: any) => ({ name: edge.node.name.full, role: edge.role, image: edge.node.image.large })) || [];

    const voiceActors = media.characters?.edges?.filter((edge: any) => edge.role === 'MAIN')
      .flatMap((edge: any) => {
        const va = edge.voiceActors?.[0];
        if (!va) return [];
        return [{ characterName: edge.node.name.full, vaName: va.name.full, vaImage: va.image.large }];
      }) || [];

    // Format Relations AND filter out any 18+ related works (like adult doujins/ovas)
    const relations = media.relations?.edges?.filter((edge: any) => edge.node.isAdult === false).map((edge: any) => ({
      relationType: edge.relationType,
      id: edge.node.id,
      title: edge.node.title,
      format: edge.node.format,
      type: edge.node.type, 
      status: edge.node.status,
      coverImage: edge.node.coverImage?.extraLarge // High quality
    })) || [];

    return c.json({
      id: media.id,
      title: media.title,
      coverImage: media.coverImage,
      bannerImage: media.bannerImage,
      description: media.description,
      episodes: media.episodes,
      status: media.status,
      averageScore: media.averageScore,
      genres: media.genres,
      seasonYear: media.seasonYear,
      format: media.format,
      startDate: formatAiringDate(media.startDate),
      endDate: formatAiringDate(media.endDate),
      studios, producers, staff, mainVoiceActors: voiceActors, 
      relations 
    });
  } catch (err) {
    return c.json({ error: "AniList Info Failed" }, 500);
  }
});

// 3. Advanced Search
anilistRouter.get('/advanced-search', async (c) => {
  const { query, type, page, perPage, format, sort, genres, id, year, status, season, countryOfOrigin } = c.req.query();

  const variables: any = {
    page: page ? parseInt(page) : 1,
    perPage: perPage ? parseInt(perPage) : 20,
    type: type || "ANIME", 
  };

  if (query) variables.search = query;
  if (format) variables.format = format;
  if (sort) variables.sort = sort.includes(',') ? sort.split(',') : [sort];
  if (genres) variables.genres = genres.includes(',') ? genres.split(',') : [genres];
  if (id) variables.id = parseInt(id);
  if (year) variables.year = parseInt(year);
  if (status) variables.status = status;
  if (season) variables.season = season;
  if (countryOfOrigin) variables.countryOfOrigin = countryOfOrigin;

  try {
    const data: any = await fetchAnilist(ADVANCED_SEARCH_QUERY, variables);
    return c.json(data.data.Page);
  } catch (err) {
    return c.json({ error: "Advanced Search Failed" }, 500);
  }
});

// 4. Trending Anime
anilistRouter.get('/trending', async (c) => {
  const page = c.req.query('page') || "1";
  const perPage = c.req.query('perPage') || "20";
  try {
    const data: any = await fetchAnilist(ADVANCED_SEARCH_QUERY, { type: "ANIME", sort: ["TRENDING_DESC"], page: parseInt(page), perPage: parseInt(perPage) });
    return c.json(data.data.Page);
  } catch (err) {
    return c.json({ error: "Trending Fetch Failed" }, 500);
  }
});

// 5. Popular Anime
anilistRouter.get('/popular', async (c) => {
  const page = c.req.query('page') || "1";
  const perPage = c.req.query('perPage') || "20";
  try {
    const data: any = await fetchAnilist(ADVANCED_SEARCH_QUERY, { type: "ANIME", sort: ["POPULARITY_DESC"], page: parseInt(page), perPage: parseInt(perPage) });
    return c.json(data.data.Page);
  } catch (err) {
    return c.json({ error: "Popular Fetch Failed" }, 500);
  }
});

// 6. Genres
anilistRouter.get('/genre', async (c) => {
  const genre = c.req.query('genre');
  const page = c.req.query('page') || "1";

  try {
    if (genre) {
      const data: any = await fetchAnilist(ADVANCED_SEARCH_QUERY, { type: "ANIME", genres: [genre], sort: ["TRENDING_DESC"], page: parseInt(page), perPage: 20 });
      return c.json(data.data.Page);
    } 
    
    const data: any = await fetchAnilist(GENRES_QUERY);
    const allGenres: string[] = data.data.GenreCollection;
    
    // Completely remove 'Hentai' from the genres list so users can't even tap it
    const safeGenres = allGenres.filter(g => g !== 'Hentai');
    
    return c.json(safeGenres);
  } catch (err) {
    return c.json({ error: "Genre Fetch Failed" }, 500);
  }
});

// 7. Recent Episodes
anilistRouter.get('/recent-episodes', async (c) => {
  const page = c.req.query('page') || "1";
  const perPage = c.req.query('perPage') || "20";
  const currentTimestamp = Math.floor(Date.now() / 1000);

  try {
    const data: any = await fetchAnilist(RECENT_EPISODES_QUERY, { page: parseInt(page), perPage: parseInt(perPage), airingAt_lesser: currentTimestamp });
    
    // AniList's airingSchedules doesn't accept the isAdult argument directly, 
    // so we filter them out right here in the code before sending to the app!
    const safeEpisodes = data.data.Page.airingSchedules.filter((item: any) => item.media.isAdult === false);
    
    // Replace the raw list with the safe list
    data.data.Page.airingSchedules = safeEpisodes;

    return c.json(data.data.Page);
  } catch (err) {
    return c.json({ error: "Recent Episodes Fetch Failed" }, 500);
  }
});

// 8. Airing Schedule (By Date Range)
anilistRouter.get('/schedule', async (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');
  if (!start || !end) return c.json({ error: "start and end timestamps required" }, 400);

  try {
    // Fetch up to 100 episodes airing within this time frame (plenty for a single day)
    const data: any = await fetchAnilist(SCHEDULE_QUERY, { start: parseInt(start), end: parseInt(end), page: 1 });
    
    // Filter out 18+ content safely
    const safeEpisodes = data.data.Page.airingSchedules.filter((item: any) => item.media.isAdult === false);
    
    return c.json(safeEpisodes);
  } catch (err) {
    return c.json({ error: "Schedule Fetch Failed" }, 500);
  }
});

export { anilistRouter };
