import json
from collections import defaultdict
from datetime import date,timedelta
d=json.load(open('latest.json')); g=d['ga4']; y=d['youtube']; n=d['naver']
p=json.load(open('prev_report.json')); crm=json.load(open('crm_raw.json'))
RUN='2026-10-23'; KEY='myauction-weekly-'+RUN
def R(k,r): return [x for x in g[k] if x.get('dateRange')==r]
# channels
sm=defaultdict(dict)
for x in g['source_medium']: sm[x['sessionSourceMedium']][x['dateRange']]=x
top=sorted(sm.items(),key=lambda kv:-kv[1].get('cur',{}).get('sessions',0))[:20]
channels=[{"source_medium":k,"sessions":v.get('cur',{}).get('sessions',0),"conversions":v.get('cur',{}).get('signups',0),
  "cvr":round(v.get('cur',{}).get('signup_rate',0),4),"prev_sessions":v.get('prev',{}).get('sessions',0),"prev_conversions":v.get('prev',{}).get('signups',0)} for k,v in top]
dv={(x['deviceCategory'],x['dateRange']):x for x in g['devices']}
devices=[{"device":c,"sessions":dv[(c,'cur')]['sessions'],"engagement_rate":round(dv[(c,'cur')]['engagementRate'],4),"new_users":dv[(c,'cur')]['newUsers'],
  "conversions":dv[(c,'cur')]['signups'],"cvr":round(dv[(c,'cur')]['signup_rate'],4),"prev_conversions":dv[(c,'prev')]['signups']} for c in ['desktop','mobile','tablet']]
landing=[{"host":x['hostName'],"device":x['deviceCategory'],"landing_page":x['landingPage'],"sessions":x['sessions'],"conversions":x['signups']} for x in sorted(R('host_landing','cur'),key=lambda x:-x['sessions'])[:15]]
au={(x['newVsReturning'],x['dateRange']):x for x in g['audience']}
audience=[{"segment":s,"sessions":au[(s,'cur')]['sessions'],"engagement_rate":round(au[(s,'cur')]['engagementRate'],4),"avg_duration_sec":round(au[(s,'cur')]['averageSessionDuration'],1),
  "conversions":au[(s,'cur')]['signups'],"prev_conversions":au[(s,'prev')]['signups']} for s in ['new','returning','(not set)']]
sig=sum(x['signups'] for x in R('channel_group','cur')); sigp=sum(x['signups'] for x in R('channel_group','prev'))
direct=[x for x in R('channel_group','cur') if x['sessionDefaultChannelGroup']=='Direct'][0]['signups']
hl={(x['hostName'],x['landingPage'],x['deviceCategory'],x['dateRange']):x for x in g['host_landing']}
app=sum(x['signups'] for x in R('host_landing','cur') if x['hostName']=='appstore.my-auction.co.kr' and x['landingPage']=='/')
pcmain=sum(x['sessions'] for x in R('host_landing','cur') if x['hostName']=='www.my-auction.co.kr' and x['landingPage']=='/main/main.php')
# youtube
ct={x['creatorContentType']:x for x in y['content_type']}
vd=y['video_daily']; up={u['video_id']:u for u in y['uploads']}; vids={v['video']:v for v in y['videos']}
S,E=date(2026,10,12),date(2026,10,18)
new=[]
for k,s in vd.items():
    nz=[r for r in s if r['views']>0]
    if not nz: continue
    f=date.fromisoformat(nz[0]['day'])
    if not (S<=f<=E): continue
    wk=sum(r['views'] for r in s if f<=date.fromisoformat(r['day'])<f+timedelta(7))
    v=vids.get(k,{}); u=up[k]
    new.append({"video_id":k,"title":u['title'],"format":u['format'],"released":f.isoformat(),"day1_views":nz[0]['views'],"week_views":wk,
      "avg_view_pct":round(v['averageViewPercentage']/100,4) if v else None,"revenue_usd":v.get('estimatedRevenue') if v else None})
new.sort(key=lambda x:x['released'])
shorts_new=[x for x in new if x['format']=='short']; d1avg=round(sum(x['day1_views'] for x in shorts_new)/len(shorts_new),1)
newids={x['video_id'] for x in new}
ever=[v for v in y['videos'] if v['video'] not in newids]
evergreen=[{"video_id":v['video'],"title":v['title'],"week_views":v['views'],"revenue_usd":v['estimatedRevenue']} for v in [x for x in ever if x['format']=='long'][:3]+[x for x in ever if x['format']=='short'][:3]]
snap=y['snapshot']; prevsnap={v['video_id']:v['views'] for v in p['youtube']['snapshot']['videos']}
inc=sorted([(v['video_id'],v['views']-prevsnap[v['video_id']]) for v in snap['videos'] if v['video_id'] in prevsnap],key=lambda x:-x[1])
tot=y['totals']; adv=[x['views'] for x in y['traffic_sources']['cur'] if x['insightTrafficSourceType']=='ADVERTISING'][0]
advp=[x['views'] for x in y['traffic_sources']['prev'] if x['insightTrafficSourceType']=='ADVERTISING'][0]
youtube={"totals":{"longform":{"views":ct['videoOnDemand']['views'],"avg_view_pct":round(ct['videoOnDemand']['averageViewPercentage']/100,4),"subs":ct['videoOnDemand']['subscribersGained']},
  "shorts":{"views":ct['shorts']['views'],"avg_view_pct":round(ct['shorts']['averageViewPercentage']/100,4),"subs":ct['shorts']['subscribersGained']},
  "revenue_usd":tot['cur'][0]['estimatedRevenue'],"revenue_usd_prev":tot['prev'][0]['estimatedRevenue']},
  "new_uploads":new,"evergreen":evergreen,"recent_uploads":y['recent_uploads'],"snapshot":snap,
  "views_total":tot['cur'][0]['views'],"views_total_prev":tot['prev'][0]['views'],"advertising_views":adv,"advertising_views_prev":advp,
  "snapshot_increase_since_prev":{"from":p['youtube']['snapshot']['taken_at'],"to":snap['taken_at'],"total":sum(i for _,i in inc),"top":[{"video_id":k,"views":i} for k,i in inc[:5]]}}
# crm
c,cp=crm['cur'],crm['prev']
labs=lambda t:['20'+l for l in t['lab']]
age_k=['10s','20s','30s','40s','50s','60s','70s','80s','unknown']
reg_k=['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주','미집계']
crmo={"source":"crm.my-auction.co.kr/admin/graph.php, graph2.php (집계값)",
 "period":{"signups":sum(crm['t_cur']['m'][0]),"withdrawals":sum(crm['t_cur']['m'][1]),"by_path":dict(zip(['google_app','apple_app','mobile_web','pc'],c[3])),
   "by_sex":{"male":c[0][0],"female":c[0][1]},"by_age":dict(zip(age_k,c[1])),"by_region":dict(zip(reg_k,c[2]))},
 "compare":{"signups":sum(crm['t_prev']['m'][0]),"withdrawals":sum(crm['t_prev']['m'][1]),"by_path":dict(zip(['google_app','apple_app','mobile_web','pc'],cp[3]))},
 "daily_signups":dict(zip(labs(crm['t_cur']),crm['t_cur']['m'][0])),
 "this_week_to_date":{"start":"2026-10-19","end":"2026-10-22","signups":sum(crm['t_wk']['m'][0]),"withdrawals":sum(crm['t_wk']['m'][1]),"daily_signups":dict(zip(labs(crm['t_wk']),crm['t_wk']['m'][0]))}}
# ads (naver) - reuse detail from prev report where unchanged, update bizmoney/bids
ads=p['ads']; biz=round(n['bizmoney']['bizmoney']); daily=round(ads['period']['cost_krw']/7)
ads['bizmoney_krw']=biz; ads['bizmoney_days_left']=round(biz/daily,1)
kw={x['keyword']+'|'+x['adgroup']:x['bid'] for x in n['keyword_stats_cur']}
for sec in ['keywords_top_spend','keywords_efficient','keywords_no_conversion','keywords_high_cpa']:
    for x in ads.get(sec,[]):
        b=kw.get(x['keyword']+'|'+x['adgroup'])
        if b is not None and b!=x.get('bid_krw'): x['bid_krw_prev_report']=x.get('bid_krw'); x['bid_krw']=b
ads['notes']=ads['notes']+["2026-10-23 수집에서 캠페인·키워드 통계는 10/19 수집과 동일. 기기별(campaign_device) 상세는 네이버 API 제한(최근 7일 이내만)으로 이번 수집 실패 → devices·device_by_campaign은 10/19 수집값 유지.","비즈머니·입찰가는 2026-10-23 07:23 KST 기준."]
json.dump(dict(channels=channels,devices=devices,landing=landing,audience=audience,youtube=youtube,crm=crmo,ads=ads,
  k=dict(sig=sig,sigp=sigp,direct=direct,app=app,pcmain=pcmain,d1avg=d1avg,adv=adv,advp=advp)),open('parts.json','w'),ensure_ascii=False,indent=1)
print(sig,sigp,direct,app,pcmain,d1avg,biz,ads['bizmoney_days_left'],crmo['period']['signups'],crmo['compare']['signups'],crmo['this_week_to_date'])
print(youtube['snapshot_increase_since_prev']); print([ (x['video_id'],x['format'],x['released'],x['day1_views'],x['week_views']) for x in new]); print([(e['video_id'],e['week_views']) for e in evergreen])
