export type Church = {
  id: number;
  slug: string;
  name: string;
  type: string;
  community: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  diocese: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  description: string | null;
  image_url: string | null;
  source: string | null;
  source_url: string | null;
};

export type Celebration = {
  id: number;
  church_id: number;
  type: string;
  rite: string;
  language: string | null;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  confidence: number;
  source: string | null;
  source_url: string | null;
};

export type ChurchDetail = Church & { celebrations: Celebration[] };

export type SearchItem = {
  church: Church;
  matched_celebrations: Celebration[];
  distance_km: number | null;
};

export type SearchResponse = {
  total: number;
  items: SearchItem[];
};

export type TaxonomyItem = { value: string; label: string };

export type Taxonomy = {
  church_types: TaxonomyItem[];
  celebration_types: TaxonomyItem[];
  rites: TaxonomyItem[];
  communities: TaxonomyItem[];
};

export type SearchFilters = {
  q?: string;
  type?: string[];
  community?: string[];
  celebration_type?: string[];
  rite?: string[];
  city?: string;
  postal_code?: string;
  day_of_week?: number;
  after?: string;
  before?: string;
  latitude?: number;
  longitude?: number;
  radius_km?: number;
};
