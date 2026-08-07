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

export class CommunityPresentationApi {
  static async list(signal?: AbortSignal): Promise<CommunityPresentationListResponse> {
    const response = await fetch(
      getApiUrl(
        "/api/v1/ppt/community/presentations?page=1&page_size=8&order_by=priority&order=desc"
      ),
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
