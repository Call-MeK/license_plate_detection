import type { VehicleType } from './api';

export const money=(value:number)=>new Intl.NumberFormat('vi-VN').format(value)+' ₫';
export const vehicleLabel=(type:VehicleType|string)=>type==='MOTORBIKE'?'Xe máy':'Ô tô';
const sameDay=(a:Date,b:Date)=>a.toDateString()===b.toDateString();

export function time(value:string){return new Date(value).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});}
/** "14:32" hôm nay, "Hôm qua 14:32", hoặc "20/10 14:32". */
export function when(value:string,now=new Date()){
 const date=new Date(value),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
 if(sameDay(date,now))return time(value);
 if(sameDay(date,yesterday))return `Hôm qua ${time(value)}`;
 return `${date.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'})} ${time(value)}`;
}
export function dayLabel(value:string,now=new Date()){
 const date=new Date(value),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
 if(sameDay(date,now))return 'Hôm nay';
 if(sameDay(date,yesterday))return 'Hôm qua';
 return date.toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});
}
export function duration(minutes:number){
 const hours=Math.floor(minutes/60),rest=minutes%60;
 if(!hours)return `${rest} phút`;
 return rest?`${hours} giờ ${rest} phút`:`${hours} giờ`;
}
/** Giống app.parking.calculate_fee: làm tròn phút lên bội số, nhân giá/60, làm tròn nửa lên. */
export function billedMinutes(minutes:number,roundingMinutes:number){return Math.ceil(minutes/roundingMinutes)*roundingMinutes;}
export function calculateFee(minutes:number,hourlyRate:number,roundingMinutes:number){return Math.round(billedMinutes(minutes,roundingMinutes)*hourlyRate/60);}
