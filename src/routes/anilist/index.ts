import { Hono } from 'hono';

// Define the router variable explicitly
const anilistRouter = new Hono();
const ANILIST_URL = 'https://graphql.anilist.co';

// Query for the Search Endpoint (Kept lightweight)
const SEARCH_QUERY = `
query ($id: Int, $page: Int, $perPage: Int, $search: String) {
  Page (page: $page, perPage: $perPage) {
    media (id: $id, search: $search, type: ANIME) {
      id
      title { romaji english native }
      coverImage { large extraLarge }
      bannerImage
      description
      episodes
      status
      averageScore
      genres
      seasonYear
      format
    }
  }
}`;

// Deep Query for the Info Endpoint
const INFO_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    coverImage { large extraLarge }
    bannerImage
    description
    episodes
    status
    averageScore
    genres
    seasonYear
    format
    startDate { year month day }
    endDate { year month day }
    studios {
      edges {
        node { name isAnimationStudio }
      }
    }
    characters(sort: ROLE) {
      edges {
        role
        node { name { full } }
        voiceActors(language: JAPANESE, sort: RELEVANCE) {
          name { full }
          image { large }
        }
      }
    }
    staff {
      edges {
        role
        node { name { full } image { large } }
      }
    }
  }
}`;

anilistRouter.get('/search', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: "Query 'q' is required" }, 400);

  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: { search: query, page: 1, perPage: 15 }
      })
    });

    const data: any = await response.json();
    return c.json(data.data.Page.media);
  } catch (err) {
    return c.json({ error: "AniList Search Failed" }, 500);
  }
});

anilistRouter.get('/info/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: INFO_QUERY, // Using the new deep query here
        variables: { id: parseInt(id) }
      })
    });

    const data: any = await response.json();
    const media = data.data?.Media;

    if (!media) return c.json({ error: "Not Found" }, 404);

    // 1. Parse Start and End Dates
    const formatAiringDate = (dateObj: any) => {
      if (!dateObj.year) return null;
      return `${dateObj.year}-${String(dateObj.month || 1).padStart(2, '0')}-${String(dateObj.day || 1).padStart(2, '0')}`;
    };

    // 2. Separate Studios and Producers
    const studios: string[] = [];
    const producers: string[] = [];
    
    media.studios?.edges?.forEach((edge: any) => {
      if (edge.node.isAnimationStudio) {
        studios.push(edge.node.name);
      } else {
        producers.push(edge.node.name);
      }
    });

    // 3. Filter specific Staff Roles
    const targetStaffRoles = ["Original Creator", "Original Story", "Director", "Assistant Director", "Character Design"];
    const staff = media.staff?.edges?.filter((edge: any) => 
      targetStaffRoles.some(targetRole => edge.role.includes(targetRole))
    ).map((edge: any) => ({
      name: edge.node.name.full,
      role: edge.role,
      image: edge.node.image.large
    })) || [];

    // 4. Filter Main Characters and their Voice Actors
    const voiceActors = media.characters?.edges?.filter((edge: any) => edge.role === 'MAIN')
      .flatMap((edge: any) => {
        const characterName = edge.node.name.full;
        const va = edge.voiceActors?.[0]; // Usually the first one is the primary Japanese VA
        
        if (!va) return []; // Skip if no VA is listed
        
        return [{
          characterName: characterName,
          vaName: va.name.full,
          vaImage: va.image.large
        }];
      }) || [];

    // 5. Construct the final customized response
    const finalResult = {
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
      studios: studios,
      producers: producers,
      staff: staff,
      mainVoiceActors: voiceActors
    };

    return c.json(finalResult);
    
  } catch (err) {
    console.error(err);
    return c.json({ error: "AniList Info Failed" }, 500);
  }
});

export { anilistRouter };
