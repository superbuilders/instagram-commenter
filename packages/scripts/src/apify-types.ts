export interface ApifyPostResult {
  id: string;
  shortCode: string;
  caption: string;
  timestamp: string;
  type: "Image" | "Video" | "Sidecar";
  url: string;
  likesCount: number;
  commentsCount: number;
  ownerUsername: string;
  hashtags?: string[];
  mentions?: string[];
  alt?: string;
  dimensionsHeight?: number;
  dimensionsWidth?: number;
}

export interface ApifyCommentReply {
  id: string;
  text: string;
  timestamp: string;
  ownerUsername: string;
  likesCount: number;
}

export interface ApifyCommentResult {
  id: string;
  text: string;
  timestamp: string;
  ownerUsername: string;
  likesCount: number;
  repliesCount: number;
  replies: ApifyCommentReply[];
  postUrl?: string;
  postShortCode?: string;
}

export interface ProcessedReplyPair {
  parentComment: {
    username: string;
    text: string;
    timestamp: string;
    likesCount: number;
  };
  mackenzieReply: {
    text: string;
    timestamp: string;
    likesCount: number;
  };
  postContext: {
    caption: string;
    permalink: string;
    postTimestamp: string;
    hashtags: string[];
    mediaType: string;
  };
}

export interface ProcessedCaption {
  caption: string;
  permalink: string;
  timestamp: string;
  mediaType: string;
  hashtags: string[];
  mentions: string[];
  likesCount: number;
  commentsCount: number;
}

export interface PoolComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  likesCount: number;
  postCaption: string;
  postPermalink: string;
  mackenzieReplied: boolean;
}

export interface VoiceAnalytics {
  replyLengths: {
    min: number;
    max: number;
    avg: number;
    median: number;
    distribution: Record<string, number>;
  };
  commonPhrases: { phrase: string; count: number }[];
  emojiUsage: Record<string, number>;
  responseTimeMinutes: number[];
  avgReplyLengthByCommentType: {
    questions: number;
    nonQuestions: number;
  };
}

export interface ScrapeMetadata {
  scrapedAt: string;
  postActorRunId?: string;
  commentActorRunId?: string;
  totalPosts: number;
  totalComments: number;
  limitUsed?: number;
}

export interface ScrapeSummary {
  totalPosts: number;
  totalComments: number;
  totalReplyPairs: number;
  replyRate: number;
  dateRange: { earliest: string; latest: string };
  avgRepliesPerPost: number;
  topEngagedCommenters: { username: string; replyCount: number }[];
}
