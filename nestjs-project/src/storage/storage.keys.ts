/** Object keys always use the video UUID PK, never the public id. */
export const videoSourceKey = (videoId: string): string =>
  `videos/${videoId}/source`;

export const videoThumbnailKey = (videoId: string): string =>
  `videos/${videoId}/thumbnail.jpg`;
