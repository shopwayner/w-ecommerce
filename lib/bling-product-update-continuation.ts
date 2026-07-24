export type BlingProductUpdateOperation = "NAME_ONLY" | "IMAGES_ONLY_APPEND";

export type BlingProductUpdateCompletion = {
  sequence: number;
  operation: BlingProductUpdateOperation;
  confirmedName?: string;
  sentImages: string[];
};

export type BlingProductModalEditableState = {
  title: string;
  nameTouched: boolean;
  remoteImages: string[];
  selectedImageIndex: number;
  selectedLocalImages: string[];
};

export function applyBlingProductUpdateCompletion(
  state: BlingProductModalEditableState,
  completion: BlingProductUpdateCompletion,
  refreshedRemoteImages: string[]
): BlingProductModalEditableState {
  const selectedImageIndex = refreshedRemoteImages.length
    ? Math.min(state.selectedImageIndex, refreshedRemoteImages.length - 1)
    : 0;

  if (completion.operation === "IMAGES_ONLY_APPEND") {
    const sentImages = new Set(completion.sentImages);
    return {
      ...state,
      remoteImages: [...refreshedRemoteImages],
      selectedImageIndex,
      selectedLocalImages: state.selectedLocalImages.filter((image) => !sentImages.has(image))
    };
  }

  return {
    ...state,
    title: completion.confirmedName ?? state.title,
    nameTouched: false,
    remoteImages: [...refreshedRemoteImages],
    selectedImageIndex
  };
}
