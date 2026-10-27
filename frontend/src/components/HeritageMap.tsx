"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, NavigationControl, LngLatBounds, type MapLayerMouseEvent } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { MapPin } from "lucide-react";

type RecordItem = { id:string;title:string;category:string;era:string|null;latitude:number|null;longitude:number|null;place:string;image_url:string;artifact:any };
type HeritageFeature = { id:string;title:string;kind:"monument"|"route"|"folklore";description:string;geometry:GeoJSON.Geometry;artifact:any };
type MapData = {artifacts:RecordItem[];features:HeritageFeature[]};

export default function HeritageMap({ api, filters, onSelect }: {api:string;filters:{region:string;category:string;era:string};onSelect:(artifact:any)=>void}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap|null>(null);
  const [data,setData] = useState<MapData>({artifacts:[],features:[]});
  const [message,setMessage] = useState("Loading mapped places…");
  const query = useMemo(()=>{const params=new URLSearchParams();if(filters.region)params.set("region",filters.region);if(filters.category)params.set("category",filters.category);if(filters.era)params.set("era",filters.era);return params.toString();},[filters]);

  useEffect(()=>{ fetch(`${api}/api/map${query?`?${query}`:""}`).then(r=>{if(!r.ok)throw new Error("Map request failed");return r.json();}).then((value:MapData)=>{setData(value);setMessage(value.artifacts.length||value.features.length?"":"No mapped items match these filters.");}).catch(()=>setMessage("Map data is unavailable while the API is offline.")); },[api,query]);

  useEffect(()=>{
    if(!container.current || map.current) return;
    const created = new MapLibreMap({container:container.current,style:{version:8,sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap contributors"}},layers:[{id:"osm",type:"raster",source:"osm"}]},center:[72.58,22.9],zoom:6});
    map.current = created;
    created.addControl(new NavigationControl({showCompass:false}),"top-right");
    return ()=>{map.current?.remove();map.current=null;};
  },[]);

  useEffect(()=>{
    const current=map.current;if(!current)return;
    const markers:Marker[]=[];
    const coordinates:number[][]=[];
    for(const item of data.artifacts){ if(item.latitude==null||item.longitude==null)continue;
      const button=document.createElement("button");button.className="map-pin monument";button.setAttribute("aria-label",item.title);button.innerHTML='<span></span>';
      button.addEventListener("click",()=>onSelect(item.artifact));
      markers.push(new Marker({element:button,anchor:"bottom"}).setLngLat([item.longitude,item.latitude]).addTo(current));
      coordinates.push([item.longitude,item.latitude]);
    }
    const routeFeatures:Feature<LineString>[]=[];
    for(const feature of data.features){
      if(feature.kind==="route"&&feature.geometry.type==="LineString"){
        routeFeatures.push({type:"Feature",geometry:feature.geometry as LineString,properties:{id:feature.id,title:feature.title}});
        coordinates.push(...feature.geometry.coordinates);
        continue;
      }
      if(feature.geometry.type!=="Point")continue;
      const [longitude,latitude]=feature.geometry.coordinates;
      const button=document.createElement("button");button.className=`map-pin ${feature.kind}`;button.setAttribute("aria-label",feature.title);button.innerHTML='<span></span>';
      button.addEventListener("click",()=>{if(feature.artifact)onSelect(feature.artifact);});
      markers.push(new Marker({element:button,anchor:"bottom"}).setLngLat([longitude,latitude]).addTo(current));
      coordinates.push([longitude,latitude]);
    }
    const sourceId="heritage-routes";const layerId="heritage-routes-line";
    if(current.getLayer(layerId))current.removeLayer(layerId);
    if(current.getSource(sourceId))current.removeSource(sourceId);
    if(routeFeatures.length){
      current.addSource(sourceId,{type:"geojson",data:{type:"FeatureCollection",features:routeFeatures} as FeatureCollection<LineString>});
      current.addLayer({id:layerId,type:"line",source:sourceId,paint:{"line-color":"#ad704f","line-width":3,"line-dasharray":[2,1.5],"line-opacity":0.9}});
      const selectRoute=(event:MapLayerMouseEvent)=>{const featureId=event.features?.[0]?.properties?.id;const record=data.features.find(item=>item.id===featureId);if(record?.artifact)onSelect(record.artifact);};
      current.on("click",layerId,selectRoute);
    }
    if(coordinates.length){const bounds=coordinates.reduce((b,point)=>b.extend([point[0],point[1]] as [number,number]),new LngLatBounds());current.fitBounds(bounds,{padding:70,maxZoom:10,duration:500});}
    return ()=>{markers.forEach(marker=>marker.remove());if(current.getLayer(layerId))current.removeLayer(layerId);if(current.getSource(sourceId))current.removeSource(sourceId);};
  },[data,onSelect]);

  const count=data.artifacts.length+data.features.length;
  return <div className="map-wrap"><div className="map-canvas" ref={container}/>{message&&<div className="map-message"><MapPin size={18}/>{message}</div>}<div className="map-legend"><b>THE LIVING MAP</b><span>{count} MAP RECORDS · MONUMENTS · ROUTES · FOLKLORE</span></div></div>;
}
