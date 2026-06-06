import React from "react";
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Audio, ResizeMode, Video } from "expo-av";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Maximize,
  FileText,
  Settings,
  Link as LinkIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  Music,
  Bookmark,
  Play,
  Pause,
} from "lucide-react-native";
import { useTranslations } from "@/i18n";
import { colors } from "@/theme/theme";
import { fonts } from "@/theme/fonts";

// Mobile: the web brick resolved `asset:<name>` refs through a local-workspace
// object-URL cache (useResolvedAssetMap / image-cache). On RN those primitives
// don't exist; `asset:`/`/uploads/` URLs resolve directly to remote URIs via
// resolveUrl, and Image/Video consume { uri } sources. framer-motion, the
// click-outside listener and all hover/group classes are dropped.

export type MediaCarouselItem = {
  url: string;
  title?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

export type MediaMeta = {
  subtitle?: string;
  items: MediaCarouselItem[];
  layout?: "left" | "center" | "right" | "full";
  border?: "none" | "soft" | "strong";
  shadow?: "none" | "md" | "lg";
};

const MEDIA_META_PREFIX = "__media_meta_v1__:";

const parseMediaMeta = (caption: string | null | undefined, fallback: MediaCarouselItem): MediaMeta => {
  if (caption && caption.startsWith(MEDIA_META_PREFIX)) {
    try {
      const parsed = JSON.parse(caption.slice(MEDIA_META_PREFIX.length));
      const items = Array.isArray(parsed?.items)
        ? parsed.items.filter((it: any) => typeof it?.url === "string" && it.url.length > 0)
        : [];
      if (items.length > 0) {
        return {
          subtitle: typeof parsed?.subtitle === "string" ? parsed.subtitle : "",
          items,
          layout: parsed.layout || "center",
          border: parsed.border || "soft",
          shadow: parsed.shadow || "none",
        };
      }
    } catch {
      // Fallback to legacy behavior below.
    }
  }

  return {
    subtitle: typeof caption === "string" && !caption.startsWith(MEDIA_META_PREFIX) ? caption : "",
    items: fallback.url ? [fallback] : [],
    layout: "center",
    border: "soft",
    shadow: "none",
  };
};

const buildMediaCaption = (meta: MediaMeta): string => {
  return `${MEDIA_META_PREFIX}${JSON.stringify({
    subtitle: meta.subtitle || "",
    items: meta.items,
    layout: meta.layout || "center",
    border: meta.border || "soft",
    shadow: meta.shadow || "none",
  })}`;
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:4000";

const resolveUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  // Mobile: asset: refs can't be resolved locally → pass through unchanged.
  if (url.startsWith("/uploads/")) return `${API_BASE_URL}${url}`;
  return url;
};

// Mobile: <audio> has no RN equivalent → expo-av Audio.Sound with a
// play/pause button + a thin progress bar.
const AudioPlayer: React.FC<{ uri: string; title?: string | null }> = ({ uri, title }) => {
  const soundRef = React.useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, [uri]);

  const toggle = async () => {
    try {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          setIsPlaying(status.isPlaying);
          const total = status.durationMillis || 1;
          setProgress(Math.min(1, (status.positionMillis || 0) / total));
          if (status.didJustFinish) {
            setIsPlaying(false);
            setProgress(0);
            void soundRef.current?.setPositionAsync(0);
          }
        });
        setIsPlaying(true);
        return;
      }
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
    } catch {
      // Ignore playback errors (unreachable URI, codec, etc.).
    }
  };

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 16,
        minWidth: 280,
        backgroundColor: colors.muted + "1a",
      }}
    >
      <Pressable
        onPress={() => void toggle()}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.primary,
        }}
      >
        {isPlaying ? (
          <Pause size={18} color={colors.primaryForeground} />
        ) : (
          <Play size={18} color={colors.primaryForeground} />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        {title ? (
          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.regular }} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
          <View style={{ width: `${progress * 100}%`, height: 4, backgroundColor: colors.primary }} />
        </View>
      </View>
    </View>
  );
};

export const UnifiedMediaBrick: React.FC<{
  brickId: string;
  kind?: string;
  content: any;
  canEdit: boolean;
  onUpdate: (content: any) => void;
  onUploadMediaFiles?: (payload: { brickId: string; files: any[] }) => Promise<void> | void;
}> = ({ brickId, kind = "media", content, canEdit, onUpdate }) => {
  const t = useTranslations("document-detail");
  const fallback: MediaCarouselItem = {
    url: content.url || "",
    title: content.title || "",
    mimeType: content.mimeType || null,
    sizeBytes: content.sizeBytes || null,
  };

  const meta = parseMediaMeta(content.caption, fallback);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [showSettings, setShowSettings] = React.useState(false);
  const [linkInput, setLinkInput] = React.useState("");

  React.useEffect(() => {
    if (activeIndex >= meta.items.length) {
      setActiveIndex(Math.max(0, meta.items.length - 1));
    }
  }, [activeIndex, meta.items.length]);

  const activeItem = meta.items[activeIndex] || fallback;
  const mime = (activeItem?.mimeType || "").toLowerCase();
  const isImage =
    mime.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(activeItem?.url || "") ||
    content.mediaType === "image";
  const isVideo =
    mime.startsWith("video/") ||
    /\.(mp4|webm|mov|ogg|m4v)$/i.test(activeItem?.url || "") ||
    content.mediaType === "video" ||
    kind === "video";
  const isAudio =
    mime.startsWith("audio/") ||
    /\.(mp3|wav|ogg|aac|flac)$/i.test(activeItem?.url || "") ||
    content.mediaType === "audio" ||
    kind === "audio";
  const isWebBookmark = content.mediaType === "bookmark" || kind === "bookmark" || mime === "text/html";

  const updateMeta = (nextMeta: MediaMeta, nextIndex = 0) => {
    const first = nextMeta.items[0];
    onUpdate({
      ...content,
      kind: "media",
      mediaType: first?.mimeType?.startsWith("video/") ? "file" : "image",
      title: first?.title || content.title || "Media",
      url: first?.url || "",
      mimeType: first?.mimeType || null,
      sizeBytes: first?.sizeBytes || null,
      caption: buildMediaCaption(nextMeta),
    });
    setActiveIndex(nextIndex);
  };

  const layout = meta.layout || "center";
  const border = meta.border || "soft";
  const shadow = meta.shadow || "none";

  const alignItems = layout === "left" ? "flex-start" : layout === "right" ? "flex-end" : "center";

  const wrapperStyle = (() => {
    const style: any = { position: "relative", marginVertical: 16 };
    if (!activeItem?.url) return { ...style, width: "100%" };
    style.overflow = "hidden";
    style.width = layout === "full" ? "100%" : "auto";
    style.maxWidth = "100%";
    if (border === "soft") {
      style.borderRadius = 12;
      style.borderWidth = 1;
      style.borderColor = colors.border + "66";
    } else if (border === "strong") {
      style.borderRadius = 12;
      style.borderWidth = 2;
      style.borderColor = colors.border;
    }
    if (shadow === "md" || shadow === "lg") {
      style.shadowColor = "#000";
      style.shadowOpacity = shadow === "lg" ? 0.3 : 0.18;
      style.shadowRadius = shadow === "lg" ? 12 : 6;
      style.shadowOffset = { width: 0, height: shadow === "lg" ? 6 : 3 };
      style.elevation = shadow === "lg" ? 8 : 4;
    }
    return style;
  })();

  const hostname = (url: string): string => {
    try {
      if (url.startsWith("http")) return new URL(url).hostname;
    } catch {
      // ignore
    }
    return url;
  };

  const submitLink = () => {
    if (!canEdit || !linkInput.trim()) return;
    const newItem: MediaCarouselItem = {
      url: linkInput.trim(),
      title: kind === "bookmark" ? "Bookmark" : "",
      mimeType: kind === "bookmark" ? "text/html" : null,
      sizeBytes: null,
    };
    if (meta.items.length === 0) {
      updateMeta({ ...meta, items: [newItem] }, 0);
    } else {
      updateMeta({ ...meta, items: [...meta.items, newItem] }, meta.items.length);
    }
    setLinkInput("");
  };

  const EmptyIcon = kind === "image" ? ImageIcon : kind === "video" ? VideoIcon : kind === "audio" ? Music : kind === "bookmark" ? Bookmark : FileText;

  const renderMedia = () => {
    if (!activeItem?.url) {
      return (
        <View
          style={{
            width: "100%",
            marginTop: 4,
            marginBottom: 4,
            borderRadius: 4,
            backgroundColor: colors.muted + "1a",
            borderWidth: 1,
            borderColor: "transparent",
            padding: 10,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <EmptyIcon size={18} color={colors.mutedForeground} />
            <View style={{ flex: 1, gap: 8 }}>
              {kind !== "bookmark" && canEdit ? (
                // Mobile: <input type=file> → caller-driven picker; we surface a hint
                // (onUploadMediaFiles wiring stays in BrickRenderer when wired).
                <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: fonts.regular }}>
                  {kind === "image"
                    ? t("brickRenderer.chooseImage")
                    : kind === "video"
                    ? t("brickRenderer.chooseVideo")
                    : kind === "audio"
                    ? t("brickRenderer.chooseAudio")
                    : t("brickRenderer.chooseFile")}
                </Text>
              ) : null}

              {canEdit ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TextInput
                    value={linkInput}
                    onChangeText={setLinkInput}
                    onSubmitEditing={submitLink}
                    placeholder={t("brickRenderer.embedPlaceholder")}
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    keyboardType="url"
                    style={{
                      flex: 1,
                      fontSize: 14,
                      color: colors.foreground,
                      fontFamily: fonts.regular,
                      paddingVertical: 2,
                    }}
                  />
                  {linkInput.trim() ? (
                    <Pressable
                      onPress={submitLink}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, backgroundColor: colors.primary }}
                    >
                      <Text style={{ fontSize: 12, fontFamily: fonts.medium, color: colors.primaryForeground }}>
                        {kind === "bookmark" ? t("brickRenderer.bookmarkButton") : t("brickRenderer.embedButton")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: fonts.regular }}>
                  {t("brickRenderer.attachPrompt")}
                </Text>
              )}
            </View>
          </View>
        </View>
      );
    }

    const uri = resolveUrl(activeItem.url);

    if (isWebBookmark) {
      return (
        <Pressable
          onPress={() => void Linking.openURL(uri)}
          style={{
            width: "100%",
            maxWidth: 480,
            alignSelf: "center",
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border + "80",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <View style={{ padding: 16, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <LinkIcon size={12} color={colors.mutedForeground} />
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.regular }} numberOfLines={1}>
                {hostname(activeItem.url)}
              </Text>
            </View>
            <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.foreground }} numberOfLines={1}>
              {activeItem.title || activeItem.url}
            </Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.regular, opacity: 0.8 }} numberOfLines={1}>
              {activeItem.url}
            </Text>
          </View>
        </Pressable>
      );
    }

    if (isVideo) {
      return (
        <Video
          source={{ uri }}
          useNativeControls
          resizeMode={layout === "full" ? ResizeMode.COVER : ResizeMode.CONTAIN}
          style={{ width: "100%", aspectRatio: 16 / 9, maxHeight: 420, backgroundColor: "#00000010" }}
        />
      );
    }

    if (isAudio) {
      return <AudioPlayer uri={uri} title={activeItem.title} />;
    }

    if (isImage) {
      return (
        <Image
          source={{ uri }}
          resizeMode={layout === "full" ? "cover" : "contain"}
          style={{ width: layout === "full" ? "100%" : 300, height: 240, maxWidth: "100%" }}
          accessibilityLabel={activeItem.title || content.title || "Media"}
        />
      );
    }

    // Generic file → download/open row.
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 16,
          minWidth: 280,
          gap: 16,
          backgroundColor: colors.muted + "1a",
          borderWidth: 1,
          borderColor: colors.border + "80",
          borderRadius: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
          <FileText size={28} color={colors.indigo} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: colors.foreground }} numberOfLines={1}>
              {activeItem.title || t("brickRenderer.defaultDocTitle")}
            </Text>
            {activeItem.sizeBytes ? (
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: fonts.regular }}>
                {(activeItem.sizeBytes / 1024 / 1024).toFixed(2)} MB
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={() => void Linking.openURL(uri)}
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, backgroundColor: colors.indigo + "1a" }}
        >
          <Text style={{ fontSize: 12, fontFamily: fonts.medium, color: colors.indigo }}>
            {t("brickRenderer.download")}
          </Text>
        </Pressable>
      </View>
    );
  };

  const alignButton = (l: MediaMeta["layout"], Icon: typeof AlignLeft) => (
    <Pressable
      onPress={() => updateMeta({ ...meta, layout: l })}
      style={{
        padding: 6,
        borderRadius: 6,
        backgroundColor: layout === l ? colors.background : "transparent",
      }}
    >
      <Icon size={16} color={layout === l ? colors.foreground : colors.mutedForeground} />
    </Pressable>
  );

  const optionRow = (
    label: string,
    options: Array<{ value: string; label: string }>,
    current: string,
    onSelect: (v: string) => void,
  ) => (
    <View style={{ flex: 1, gap: 8 }}>
      <Text style={{ fontSize: 11, fontFamily: fonts.semibold, color: colors.mutedForeground, letterSpacing: 0.5 }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {options.map((opt) => {
          const active = current === opt.value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : colors.background,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: fonts.regular,
                  color: active ? colors.primaryForeground : colors.foreground,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flexDirection: "column", marginVertical: 16, alignItems: alignItems as any }}>
      <View style={wrapperStyle}>
        {renderMedia()}

        {/* CAROUSEL CONTROLS */}
        {meta.items.length > 1 ? (
          <>
            <Pressable
              onPress={() => setActiveIndex((prev) => (prev - 1 + meta.items.length) % meta.items.length)}
              style={{
                position: "absolute",
                left: 8,
                top: "50%",
                transform: [{ translateY: -14 }],
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border + "66",
                backgroundColor: colors.background + "cc",
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: fonts.regular }}>Prev</Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveIndex((prev) => (prev + 1) % meta.items.length)}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: [{ translateY: -14 }],
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border + "66",
                backgroundColor: colors.background + "cc",
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: fonts.regular }}>Next</Text>
            </Pressable>
            <View
              style={{
                position: "absolute",
                bottom: 8,
                right: 8,
                borderRadius: 6,
                backgroundColor: colors.background + "cc",
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text style={{ fontSize: 11, fontFamily: fonts.semibold, color: colors.foreground }}>
                {activeIndex + 1} / {meta.items.length}
              </Text>
            </View>
          </>
        ) : null}

        {/* EDIT BUTTON */}
        {canEdit && activeItem?.url ? (
          <Pressable
            onPress={() => setShowSettings(!showSettings)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              borderRadius: 6,
              backgroundColor: colors.background + "e6",
              borderWidth: 1,
              borderColor: colors.border + "80",
              padding: 6,
            }}
          >
            <Settings size={16} color={colors.foreground} />
          </Pressable>
        ) : null}
      </View>

      {/* SUBTITLE */}
      {showSettings ? null : (
        <View style={{ marginTop: 8, width: "100%", maxWidth: 560, alignItems: "center" }}>
          {canEdit ? (
            <TextInput
              value={meta.subtitle || ""}
              onChangeText={(text) => updateMeta({ ...meta, subtitle: text }, activeIndex)}
              placeholder={t("brickRenderer.subtitlePlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              style={{
                textAlign: "center",
                fontSize: 14,
                color: colors.mutedForeground,
                fontFamily: fonts.regular,
                width: "100%",
              }}
            />
          ) : meta.subtitle ? (
            <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: fonts.regular }}>
              {meta.subtitle}
            </Text>
          ) : null}
        </View>
      )}

      {/* SETTINGS PANEL */}
      {showSettings && canEdit ? (
        <View
          style={{
            width: "100%",
            maxWidth: 560,
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border + "99",
            backgroundColor: colors.muted + "1a",
            gap: 16,
          }}
        >
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 11, fontFamily: fonts.semibold, color: colors.mutedForeground, letterSpacing: 0.5 }}>
              {t("brickRenderer.alignment")}
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: colors.muted + "33",
                padding: 4,
                borderRadius: 8,
                alignSelf: "flex-start",
                borderWidth: 1,
                borderColor: colors.border + "80",
              }}
            >
              {alignButton("left", AlignLeft)}
              {alignButton("center", AlignCenter)}
              {alignButton("right", AlignRight)}
              {alignButton("full", Maximize)}
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 16 }}>
            {optionRow(
              t("brickRenderer.borders"),
              [
                { value: "none", label: t("brickRenderer.borderNone") },
                { value: "soft", label: t("brickRenderer.borderSoft") },
                { value: "strong", label: t("brickRenderer.borderStrong") },
              ],
              border,
              (v) => updateMeta({ ...meta, border: v as any }),
            )}
            {optionRow(
              t("brickRenderer.shadow"),
              [
                { value: "none", label: t("brickRenderer.shadowNone") },
                { value: "md", label: t("brickRenderer.shadowMd") },
                { value: "lg", label: t("brickRenderer.shadowLg") },
              ],
              shadow,
              (v) => updateMeta({ ...meta, shadow: v as any }),
            )}
          </View>

          <View style={{ gap: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border + "66" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <LinkIcon size={16} color={colors.mutedForeground} />
              <TextInput
                value={activeItem?.url || ""}
                placeholder={t("brickRenderer.urlPlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                onChangeText={(text) => {
                  const newItems = [...meta.items];
                  newItems[activeIndex] = { ...activeItem, url: text };
                  updateMeta({ ...meta, items: newItems }, activeIndex);
                }}
                style={{
                  flex: 1,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  fontSize: 14,
                  color: colors.foreground,
                  fontFamily: fonts.regular,
                }}
              />
            </View>

            <TextInput
              value={meta.subtitle || ""}
              placeholder={t("brickRenderer.subtitleGeneralPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              onChangeText={(text) => updateMeta({ ...meta, subtitle: text }, activeIndex)}
              style={{
                width: "100%",
                borderRadius: 6,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
                paddingHorizontal: 12,
                paddingVertical: 8,
                fontSize: 14,
                color: colors.foreground,
                fontFamily: fonts.regular,
              }}
            />

            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
              <Pressable
                onPress={() => setShowSettings(false)}
                style={{
                  marginLeft: "auto",
                  backgroundColor: colors.primary,
                  paddingHorizontal: 16,
                  paddingVertical: 6,
                  borderRadius: 6,
                }}
              >
                <Text style={{ fontSize: 12, fontFamily: fonts.semibold, color: colors.primaryForeground }}>
                  {t("brickRenderer.acceptControls")}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Carousel thumbnails */}
          {meta.items.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, padding: 8 }}
              style={{ backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border + "66" }}
            >
              {meta.items.map((item, idx) => {
                const itemMime = (item.mimeType || "").toLowerCase();
                const thumbImage =
                  itemMime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(item.url || "");
                return (
                  <Pressable
                    key={`${item.url}-${idx}`}
                    onPress={() => setActiveIndex(idx)}
                    style={{
                      height: 48,
                      width: 64,
                      overflow: "hidden",
                      borderRadius: 6,
                      borderWidth: idx === activeIndex ? 2 : 1,
                      borderColor: idx === activeIndex ? colors.primary : colors.border + "99",
                    }}
                  >
                    {thumbImage ? (
                      <Image source={{ uri: resolveUrl(item.url) }} style={{ height: "100%", width: "100%" }} resizeMode="cover" />
                    ) : (
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.muted + "33" }}>
                        <Text style={{ fontSize: 9, fontFamily: fonts.semibold, color: colors.mutedForeground }}>FILE</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};
