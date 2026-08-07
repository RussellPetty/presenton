import { ApiResponseHandler } from "./api-error-handler";
import { getHeader } from "./header";
import { getApiUrl } from "@/utils/api";

export interface CommunityPresentation {
  id: number;
  title?: string | null;
  description?: string | null;
  created_by?: string | null;
  likes?: number | null;
  views?: number | null;
  slides?: string[];
  fonts?: Record<string, string> | null;
  prompt?: string | null;
}

export interface CommunityPresentationListResponse {
  total_pages: number;
  page: number;
  page_size: number;
  results: CommunityPresentation[];
}

export type CommunityPresentationOrderBy =
  | "created_at"
  | "views"
  | "likes"
  | "priority";

export type CommunityPresentationSortOrder = "asc" | "desc";

export interface CommunityPresentationListFilters {
  created_at_gt?: string;
  created_at_lt?: string;
  views?: number;
  views_gt?: number;
  views_lt?: number;
  likes?: number;
  likes_gt?: number;
  likes_lt?: number;
  order_by?: CommunityPresentationOrderBy;
  order?: CommunityPresentationSortOrder;
}

export class CommunityPresentationApi {
  static async list(
    signal?: AbortSignal,
    filters: CommunityPresentationListFilters = {}
  ): Promise<CommunityPresentationListResponse> {
    const params = new URLSearchParams({
      page: "1",
      page_size: "8",
      order_by: filters.order_by ?? "priority",
      order: filters.order ?? "desc",
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, String(value));
      }
    });

    const response = await fetch(
      getApiUrl(`/api/v1/ppt/community/presentations?${params.toString()}`),
      {
        headers: getHeader(),
        cache: "no-cache",
        signal,
      }
    );
    return ApiResponseHandler.handleResponse(
      response,
      "Failed to load community references"
    );
  }

  static async getById(id: number): Promise<CommunityPresentation> {
    const response = await fetch(
      getApiUrl(`/api/v1/ppt/community/presentations/${id}`),
      { headers: getHeader(), cache: "no-cache" }
    );
    return ApiResponseHandler.handleResponse(
      response,
      "Failed to load the community reference"
    );
  }
}
