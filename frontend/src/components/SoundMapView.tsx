import React, { useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

export type MapMarker = {
  user_id: string;
  display_name: string;
  profile_image?: string;
  lat?: number;
  lng?: number;
  current_track?: any;
  is_playing?: boolean;
  host_session?: boolean;
  isSelf?: boolean;
};

type Props = {
  apiKey: string;
  markers: MapMarker[];
  myLocation?: { lat: number; lng: number } | null;
  onMarkerPress?: (userId: string) => void;
};

const DEFAULT_CENTER = { lat: 40.758, lng: -73.9855 }; // Times Square fallback

function buildHtml(apiKey: string): string {
  const center = DEFAULT_CENTER;
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="initial-scale=1.0, width=device-width, user-scalable=no" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background:#05050A; }
  .bubble {
    position: relative;
    display: flex; flex-direction: column; align-items: center;
    transform: translate(-50%, -100%);
    pointer-events: auto;
    cursor: pointer;
  }
  .avatar-wrap {
    width: 56px; height: 56px; border-radius: 50%;
    padding: 3px;
    background: linear-gradient(135deg, #D4FF00, #BEE600);
    box-shadow: 0 0 18px rgba(212,255,0,0.55);
    animation: pulse 2.4s ease-in-out infinite;
  }
  .avatar-wrap.self { background: linear-gradient(135deg, #FF4500, #FF8A00); box-shadow: 0 0 18px rgba(255,69,0,0.55);}
  .avatar-wrap.hosting { background: linear-gradient(135deg, #D4FF00, #00FFE0); animation: pulse 1.3s ease-in-out infinite;}
  .avatar-wrap.paused { background: rgba(255,255,255,0.25); box-shadow: none; animation: none;}
  .avatar {
    width: 100%; height: 100%; border-radius: 50%;
    background-size: cover; background-position: center;
    background-color: #12121A;
    border: 2px solid #05050A;
  }
  .pill {
    margin-top: 6px;
    max-width: 160px;
    padding: 4px 10px;
    background: rgba(0,0,0,0.75);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 999px;
    color: #fff;
    font: 600 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
    display: flex; align-items: center; gap: 6px;
  }
  .pill .dot { width:6px; height:6px; border-radius:50%; background:#D4FF00; box-shadow:0 0 6px #D4FF00;}
  .pill.paused .dot { background: rgba(255,255,255,0.35); box-shadow:none; }
  @keyframes pulse {
    0%,100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  let map;
  let markers = {};
  let meId = null;

  function post(msg){
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch(e) {}
    try { window.parent && window.parent.postMessage(JSON.stringify(msg), '*'); } catch(e) {}
  }

  window.initMap = function() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: ${center.lat}, lng: ${center.lng} },
      zoom: 12,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      backgroundColor: '#05050A',
      styles: DARK_STYLE,
    });
    post({ type: 'map:ready' });
  };

  function upsertMarker(u) {
    if (!u.lat || !u.lng) return;
    const existing = markers[u.user_id];
    if (existing) {
      existing.setPosition({ lat: u.lat, lng: u.lng });
      existing.__data = u;
      refreshContent(existing);
      return;
    }
    const div = document.createElement('div');
    div.className = 'bubble';
    div.addEventListener('click', () => post({ type: 'marker:click', user_id: u.user_id }));
    const marker = new AdvancedBubble(new google.maps.LatLng(u.lat, u.lng), map, div);
    marker.__el = div;
    marker.__data = u;
    refreshContent(marker);
    markers[u.user_id] = marker;
  }

  function refreshContent(marker) {
    const u = marker.__data;
    const self = u.user_id === meId;
    const hosting = !!u.host_session;
    const playing = !!u.is_playing;
    const track = u.current_track;
    const title = track && track.item ? track.item.name : (track && track.name ? track.name : '');
    const img = u.profile_image || '';
    const classes = ['avatar-wrap'];
    if (self) classes.push('self');
    else if (hosting) classes.push('hosting');
    else if (!playing) classes.push('paused');
    marker.__el.innerHTML =
      '<div class="'+classes.join(' ')+'"><div class="avatar" style="background-image:url(\\''+img+'\\')"></div></div>' +
      (title ? '<div class="pill '+(playing?'':'paused')+'"><span class="dot"></span><span>'+escapeHtml(title)+'</span></div>' : '');
  }

  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function removeMarker(uid){ if(markers[uid]){ markers[uid].setMap(null); delete markers[uid]; } }

  function handle(data) {
    if (data.type === 'set_self') {
      meId = data.user_id;
    } else if (data.type === 'set_markers') {
      const keep = new Set();
      (data.markers || []).forEach(m => { upsertMarker(m); keep.add(m.user_id); });
      Object.keys(markers).forEach(id => { if (!keep.has(id)) removeMarker(id); });
    } else if (data.type === 'center') {
      if (map) map.panTo({ lat: data.lat, lng: data.lng });
    }
  }

  window.__handle = handle;
  window.addEventListener('message', (e) => {
    try { const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; handle(d); } catch(_){}
  });
  document.addEventListener('message', (e) => {
    try { const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; handle(d); } catch(_){}
  });

  // Advanced "DOM" overlay for bubble markers
  function AdvancedBubble(position, map, el){
    this.position = position; this.el = el;
    this.setMap(map);
  }
  AdvancedBubble.prototype = new google.maps.OverlayView();
  AdvancedBubble.prototype.onAdd = function(){
    const panes = this.getPanes();
    this.el.style.position = 'absolute';
    panes.overlayMouseTarget.appendChild(this.el);
  };
  AdvancedBubble.prototype.draw = function(){
    const proj = this.getProjection();
    if (!proj) return;
    const p = proj.fromLatLngToDivPixel(this.position);
    this.el.style.left = p.x + 'px';
    this.el.style.top = p.y + 'px';
  };
  AdvancedBubble.prototype.onRemove = function(){ if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el); };
  AdvancedBubble.prototype.setPosition = function(latLng){ this.position = latLng; this.draw(); };

  const DARK_STYLE = [
    {elementType:'geometry',stylers:[{color:'#0a0a12'}]},
    {elementType:'labels.text.stroke',stylers:[{color:'#0a0a12'}]},
    {elementType:'labels.text.fill',stylers:[{color:'#746855'}]},
    {featureType:'administrative.locality',elementType:'labels.text.fill',stylers:[{color:'#d59563'}]},
    {featureType:'poi',elementType:'labels.text.fill',stylers:[{color:'#d59563'}]},
    {featureType:'poi.park',elementType:'geometry',stylers:[{color:'#10231a'}]},
    {featureType:'road',elementType:'geometry',stylers:[{color:'#1a1a28'}]},
    {featureType:'road',elementType:'geometry.stroke',stylers:[{color:'#0a0a12'}]},
    {featureType:'road',elementType:'labels.text.fill',stylers:[{color:'#9ca3af'}]},
    {featureType:'road.highway',elementType:'geometry',stylers:[{color:'#2a2a3f'}]},
    {featureType:'transit',elementType:'geometry',stylers:[{color:'#2f3948'}]},
    {featureType:'water',elementType:'geometry',stylers:[{color:'#020617'}]},
    {featureType:'water',elementType:'labels.text.fill',stylers:[{color:'#515c6d'}]},
  ];
</script>
<script src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap" async defer></script>
</body>
</html>`;
}

export default function SoundMapView({ apiKey, markers, myLocation, onMarkerPress }: Props) {
  const html = useMemo(() => buildHtml(apiKey), [apiKey]);
  const iframeRef = useRef<any>(null);
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);

  const postToMap = (msg: any) => {
    const json = JSON.stringify(msg);
    if (Platform.OS === "web") {
      const el = iframeRef.current;
      if (el && el.contentWindow) el.contentWindow.postMessage(json, "*");
    } else {
      webViewRef.current?.postMessage(json);
      webViewRef.current?.injectJavaScript(`window.__handle && window.__handle(${json}); true;`);
    }
  };

  useEffect(() => {
    if (!readyRef.current) return;
    postToMap({ type: "set_markers", markers });
  }, [markers]);

  useEffect(() => {
    if (!readyRef.current) return;
    if (myLocation) postToMap({ type: "center", lat: myLocation.lat, lng: myLocation.lng });
  }, [myLocation?.lat, myLocation?.lng]);

  const handleMessage = (dataRaw: string) => {
    try {
      const d = JSON.parse(dataRaw);
      if (d.type === "map:ready") {
        readyRef.current = true;
        postToMap({ type: "set_markers", markers });
        if (myLocation) postToMap({ type: "center", ...myLocation });
      } else if (d.type === "marker:click" && onMarkerPress) {
        onMarkerPress(d.user_id);
      }
    } catch (_) {}
  };

  if (Platform.OS === "web") {
    useEffect(() => {
      const onMsg = (e: MessageEvent) => {
        if (typeof e.data === "string") handleMessage(e.data);
      };
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, []);
    return (
      <View style={styles.container}>
        {React.createElement("iframe", {
          ref: iframeRef,
          srcDoc: html,
          style: {
            border: "none",
            width: "100%",
            height: "100%",
            display: "block",
          },
          title: "soundmap",
          "data-testid": "soundmap-iframe",
        })}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://maps.google.com" }}
        onMessage={(e: WebViewMessageEvent) => handleMessage(e.nativeEvent.data)}
        javaScriptEnabled
        domStorageEnabled
        style={{ flex: 1, backgroundColor: "#05050A" }}
        testID="soundmap-webview"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#05050A" },
});
