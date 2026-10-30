import json,datetime
P=json.load(open('parts.json')); p=json.load(open('prev_report.json')); K=P['k']; yt=P['youtube']; crm=P['crm']; ads=P['ads']
RUN='2026-10-23'; KEY='myauction-weekly-'+RUN
dev={x['device']:x for x in P['devices']}
pk=p['kpis']
kpis={"signups":1680,"signups_per_day":240.0,"signups_prev":1778,"direct_share":round(1424/1680,4),"naver_search_cvr":0.0246,"google_organic_signups":22,
 "youtube_sessions":41,"ig_followers":pk['ig_followers'],"ig_reach_avg":pk['ig_reach_avg'],"reels_views_avg":pk['reels_views_avg'],
 "desktop_cvr":dev['desktop']['cvr'],"mobile_cvr":dev['mobile']['cvr'],"app_webview_signups":K['app'],"new_user_signups":1412,"pc_main_landing_sessions":K['pcmain'],
 "yt_longform_views":yt['totals']['longform']['views'],"yt_shorts_views":yt['totals']['shorts']['views'],"yt_revenue_usd":yt['totals']['revenue_usd'],"yt_shorts_day1_avg":K['d1avg'],
 "naver_ad_cost_krw":ads['period']['cost_krw'],"naver_ad_clicks":ads['period']['clicks'],"naver_ad_conversions":ads['period']['conversions'],"naver_ad_cpa_krw":ads['period']['cpa_krw'],
 "crm_signups":crm['period']['signups'],"crm_signups_prev":crm['compare']['signups'],"crm_withdrawals":crm['period']['withdrawals'],
 "crm_pc_signups":crm['period']['by_path']['pc'],"crm_app_signups":crm['period']['by_path']['google_app']+crm['period']['by_path']['apple_app'],
 "yt_views_total":yt['views_total'],"yt_views_total_prev":yt['views_total_prev'],"naver_bizmoney_krw":ads['bizmoney_krw']}
summary=("10/12~18 GA4 가입 1,680건(일 240), 전주 1,778 대비 -5.5%(CRM 1,673→1,583, -5.4%). 감소는 모바일에 집중(가입 1,094→928, 전환율 2.35%→2.01%): m.my-auction.co.kr 메인 랜딩 가입 861→731, 네이버 모바일 검색 가입 208→147. PC는 가입 650→701. "
 "유튜브는 확정치로 정정: 조회 90,357(+11.4%, 지난 보고 64,782는 미확정), 수익 $45.06(+23.2%), 광고 조회 44,202(48.9%). 이번 주(10/19~22) 가입은 GA4 1,102·CRM 1,045로 일 260~275 회복세. "
 "인스타 API가 이번 수집에서 차단(HTTP 400)돼 인스타 수치는 10/19 수집값(일 도달 6,472, 릴스 평균 2,407)을 그대로 씀. 네이버 비즈머니 56.5만원(약 3.1일분).")
assert len(summary)<=500, len(summary)
highlights=[
 {"label":"GA4 가입(주)","value":1680,"previous":1778,"baseline":209,"note":"일평균 240 — 평시 209보다 높고 바이럴 이후 296보다 낮음. 감소분 98건 중 모바일이 166건 감소, PC +51·태블릿 +17"},
 {"label":"유튜브 조회(확정)","value":yt['views_total'],"previous":yt['views_total_prev'],"baseline":None,"note":"롱폼 71,043·숏폼 19,242, 수익 $45.06(전주 $36.59). 지난 보고(64,782·$34.53)는 10/17~18 미집계분이 빠진 값 → 정정"},
 {"label":"모바일 가입","value":928,"previous":1094,"baseline":None,"note":"세션 46,487→46,288로 같은데 전환율 0.0235→0.0201. CRM 앱 가입(구글+애플) 1,027→899도 같은 방향"}]
warnings=[
 {"level":"warn","text":"인스타그램 수집 실패: 10/23 collect에서 Instagram API가 'HTTP 400: API access blocked (code 200)' 반환 — 계정·게시물·도달 전부 미수집. 토큰 갱신 문제가 아니라 Meta 앱 접근 차단으로 보임(추정). 이번 보고의 인스타 수치는 10/19 수집값."},
 {"level":"warn","text":"모바일 가입 -15.2%(1,094→928). 세션은 그대로, 전환율만 0.0235→0.0201. m.my-auction.co.kr / 랜딩 가입 861→731(세션 30,762→30,733), 네이버 모바일 검색 유입 가입 208→147(-29%), 직접 모바일 857→745. CRM에서도 앱 가입 1,027→899·모바일웹 83→65. 추정 원인: 모바일 메인·가입 화면 변경 또는 검색 유입 질 변화 — 배포 이력 확인 필요."},
 {"level":"warn","text":"인스타 일 도달 평균 6,472(10/19 수집 기준)로 장기 기준 7천~1.4만 하회. 릴스 7편 평균 조회 2,407(전주 4,356), 5만 이상 릴스 없음, 훅 공식 준수 0/7."},
 {"level":"warn","text":"네이버 비즈머니 564,697원 — 일평균 광고비 180,935원 기준 약 3.1일분(지난 보고 시점 2.4일분에서 충전됨). 주말 전 추가 충전 필요 여부 확인."},
 {"level":"warn","text":"유튜브 광고 조회 44,202회(전체의 48.9%)인데 GA4 youtube/video 유입은 41세션·가입 0(pinned·desc 오가닉 링크). 광고가 사이트 유입으로 측정되지 않음."},
 {"level":"warn","text":"네이버 광고 클릭 5,357·전환 438인데 GA4 광고 유입(m.ad.search.naver.com)은 178세션·가입 1(전주 11). 광고 클릭 상당수가 GA4에서 직접/자연검색으로 분류되는 것으로 보임(추정) — 직접 비중 0.848(기준 0.83)이 높은 원인 후보."},
 {"level":"info","text":"10/22(실행 전날) Unassigned 7,879세션·가입 217, 같은 날 Direct 가입 4 — 가입이 Unassigned로 몰림. 미확정 데이터 현상으로 보고 다음 수집에서 재확인. 확정일(10/12~20) Unassigned는 일 최대 358로 정상."},
 {"level":"info","text":"이번 주 회복세: 10/19~22 GA4 가입 323·274·251·254(4일 1,102, 10/22 미확정), CRM 314·262·234·235(1,045). 지난주 후반(10/15~18) 일 200 안팎에서 반등."},
 {"level":"info","text":"GA4 가입 1,680 vs CRM 1,583: +6.1%(±10% 이내). 기기 추세 일치 — PC: GA4 desktop 650→701, CRM PC 563→619 / 모바일: GA4 1,094→928, CRM 앱+모바일웹 1,110→964."},
 {"level":"info","text":"(not set) 유입 가입 27→47 중 PC 25→39 — 세션 1,075로 표본 작음, 추이만 관찰. m.ad.search.naver.com 가입 11→1은 세션 300 미만으로 결론 보류. 주요 이벤트는 회원가입완료뿐(혼입 없음)."},
 {"level":"info","text":"유튜브 같은 제목 숏폼 중복: 6si1YfDLAgE(10/15)·K_DAE3l6-xk(10/18) '14억 5천짜리 아파트가 단돈 4,095만 원' — 첫날 1,349·1,499. 북항재개발도 롱폼(exQElFJ0KZ4)과 숏폼(u_dWHWu1AH4)이 같은 제목으로 10/20 공개."}]
checks=[
 {"key":"task0_pc_gtag","item":"작업0 PC 메인 GA4 태그","status":"pending","evidence":"www.my-auction.co.kr /main/main.php 랜딩 0세션(10/12~18). PC 랜딩은 /member/login.php 32,451세션에 집중."},
 {"key":"task1_4_signup","item":"작업1~4 첫 유입 쿠키·가입경로·sign_up","status":"pending","evidence":"events에 sign_up 없음(회원가입완료만). 직접 비중 0.848로 기준 0.83보다 높음."},
 {"key":"utm_guide","item":"UTM 가이드","status":"partial","evidence":"youtube/video(pinned·desc) 41세션, ig/social 47세션 유입. reels_·boost_·lecture_ad 캠페인 유입 없음."},
 {"key":"yt_ad_goal","item":"유튜브 광고 목표 변경","status":"pending","evidence":"ADVERTISING 조회 44,202(48.9%)인데 youtube 사이트 유입 41세션은 오가닉 링크뿐, 가입 0. 광고발 사이트 유입 확인 안 됨."}]
todos=[
 "인스타(담당: 계정 관리자): Meta 개발자 앱 대시보드에서 앱 상태(제한·검수 요청)와 instagram_business_manage_insights 권한을 확인하고, 해제되면 GitHub Actions collect를 수동 실행해 10/12~18 인스타 수치를 확정해 주세요.",
 "개발: 10/12 이후 m.my-auction.co.kr 메인(/)·가입 화면·앱 웹뷰의 배포·팝업 변경 이력을 확인해 주세요. 모바일 메인 랜딩 가입 전환율 2.80%→2.38%, 네이버 모바일 검색 유입 가입 208→147이 같은 주에 떨어졌습니다.",
 "유튜브 광고: 캠페인 목표를 웹사이트 전환으로 바꾸고 광고 링크에 utm_source=youtube&utm_medium=paid&utm_campaign=lecture_ad를 붙여 주세요(광고 조회 4.4만 회의 사이트 유입이 현재 0으로 측정).",
 "네이버 광고: 비즈머니를 주말 전 충전하고(약 3.1일분), 아직 입찰가가 그대로인 대법원경매(CPA 11,153원·입찰 120)·대법원경매정보(8,060원·300)·경매 부산/경남 PC(7,255원·300)를 낮춰 주세요. 부동산경매·부동산경매사이트·무료경매사이트는 20원씩 인하 반영 확인."]
corrections=[
 "유튜브 10/12~18(지난 보고 myauction-weekly-2026-10-19): 조회 64,782 → 90,357(롱폼 50,963→71,043, 숏폼 13,900→19,242), 수익 $34.53 → $45.06, 광고 조회 30,122 → 44,202, 숏폼 첫날 평균 1,411.4 → 1,403.1. 10/19 수집 시점에 10/17~18 데이터가 미집계였음. 전주 대비 증감도 -20.1% → +11.4%로 바뀜.",
 "CRM 10/12~18 가입 1,585 → 1,583(10/16 190→189, 10/17 188→187; 구글앱 741→739), 비교 기간 1,674 → 1,673. 현재 회원 기준 집계라 이후 탈퇴분이 빠진 것으로 보임(추정)."]
reels=p['reels']
ch=P['channels']
def t(rows,hdr): return "| "+" | ".join(hdr)+" |\n|"+"---|"*len(hdr)+"\n"+"\n".join("| "+" | ".join(str(c) for c in r)+" |" for r in rows)
cr=crm['period']; cc=crm['compare']
age=sorted([(k,v) for k,v in cr['by_age'].items() if k!='unknown'],key=lambda x:-x[1])[:4]
reg=sorted(cr['by_region'].items(),key=lambda x:-x[1])[:5]
md=f"""# 마이옥션 주간 마케팅 점검 {RUN}

- 분석 기간: 2026-10-12(월) ~ 2026-10-18(일) / 비교: 2026-10-05 ~ 10-11
- 원천: GA4 Data API, YouTube Analytics/Data API, 네이버 검색광고 API(GitHub Actions collect, 2026-10-23 08:23 KST 수집), CRM(집계 화면). 인스타그램은 이번 수집 실패(API access blocked) → 10/19 수집값 사용. Search Console·Google Ads 연결 필요.

## 1. 요약
{summary}

## 2. 정정
""" + "\n".join("- "+c for c in corrections) + f"""

## 3. 가입·기기
{t([[x['device'],f"{x['sessions']:,}",f"{x['engagement_rate']:.1%}",x['conversions'],x['prev_conversions'],f"{x['cvr']:.2%}"] for x in P['devices']],['기기','세션','참여율','가입','전주 가입','전환율'])}

- 가입 1,680(전주 1,778, -5.5%) — 직접 1,424(0.848), 자연검색 208(전주 266), Unassigned 47.
- 신규 사용자 가입 1,412(전주 1,473), 재방문 268(305).
- 호스트·랜딩: m.my-auction.co.kr / 30,733세션·가입 731(전주 861), www /member/login.php 32,451세션·390(339), appstore / 5,061세션·150(169), www /member/join.php 279세션·144(132). www /main/main.php 0세션.

## 4. 유입 채널 (상위 12)
{t([[x['source_medium'],f"{x['sessions']:,}",x['conversions'],f"{x['cvr']:.2%}",f"{x['prev_sessions']:,}",x['prev_conversions']] for x in ch[:12]],['소스/매체','세션','가입','전환율','전주 세션','전주 가입'])}

- 네이버 모바일 검색(m.search.naver.com) 모바일 가입 208→147이 감소의 큰 축. 구글 오가닉 가입 20→22(PC 6→4, 모바일 13→18).

## 5. 일별 추이
- GA4 가입 10/12~18: 285·271·296·235·202·196·195 → 10/19~22: 323·274·251·254(10/22 미확정).
- CRM 가입 10/12~18: {'·'.join(str(v) for v in crm['daily_signups'].values())} → 10/19~22: {'·'.join(str(v) for v in crm['this_week_to_date']['daily_signups'].values())}.
- 10/22 Unassigned 7,879세션(가입 217)은 미확정 현상으로 보고 다음 수집에서 확인.

## 6. CRM 회원 지표
{t([['가입',cr['signups'],cc['signups']],['탈퇴',cr['withdrawals'],cc['withdrawals']],['구글 앱',cr['by_path']['google_app'],cc['by_path']['google_app']],['애플 앱',cr['by_path']['apple_app'],cc['by_path']['apple_app']],['모바일웹',cr['by_path']['mobile_web'],cc['by_path']['mobile_web']],['PC',cr['by_path']['pc'],cc['by_path']['pc']],['남/여',f"{cr['by_sex']['male']}/{cr['by_sex']['female']}",'982/691']],['항목','10/12~18','10/5~11'])}

- 연령 상위: {', '.join(f'{k} {v}' for k,v in age)} / 지역 상위: {', '.join(f'{k} {v}' for k,v in reg)}
- GA4 대비 +6.1%(info). PC는 양쪽 모두 증가, 앱·모바일은 양쪽 모두 감소 — 추세 일치.

## 7. 유튜브 (확정치)
- 전체 조회 {yt['views_total']:,}(전주 {yt['views_total_prev']:,}, +11.4%), 수익 ${yt['totals']['revenue_usd']}(전주 ${yt['totals']['revenue_usd_prev']}).
- 롱폼 71,043(평균 시청률 30.2%, 구독 +164) / 숏폼 19,242(72.5%, +16).
- 트래픽: 광고 44,202(48.9%), 구독자 15,836(전주 9,317), 검색 12,753, 쇼츠 피드 11,757.
- 이번 주 공개분: 롱폼 '15억이 30억으로?'(WpubrgfHt-I) 첫날 3,846·7일 8,455·수익 $4.67. 숏폼 7편 첫날 평균 {K['d1avg']} — 최고 '9천만 원으로 서울 재개발 땅'(1,853 / 7일 2,660).
- 기존 영상: '무료 경매강의 몰아보기'(lHm_fDfUPi8) 48,683회·$25.71(전체 조회의 54%), '강제집행 중 문을 막는 의문의 남성'(2,700).
- 인스타 대비(같은 훅): 대치동 1,483만원 — 릴스 4,390 vs 숏폼 1,856 / 모아타운 9천만원 — 릴스 2,312 vs 숏폼 2,588 / 4,095만원 — 릴스 2,353 vs 숏폼 1,540+1,499(중복 업로드).
- 10/19→10/23 스냅샷 누적 증가(상위 50편 중 공통분): {yt['snapshot_increase_since_prev']['total']:,}회.
- 10/19~22 공개분: 롱폼 북항재개발(exQElFJ0KZ4) 62시간 5,088회(시간당 81), 숏폼 '76평형 반값 12억' 14시간 1,215회(시간당 85).

## 8. 인스타그램 (10/19 수집값, 이번 수집 실패)
- 팔로워 6,864, 일 도달 평균 6,472(전주 9,583), 웹사이트 클릭 13(28), 프로필 방문 541(854).
{t([[r['date'],r['hook'],f"{r['views']:,}",f"{r['reach']:,}",r['saved'],r['shares'],'O' if r['formula_ok'] else 'X'] for r in reels],['날짜','훅','조회','도달','저장','공유','공식'])}

## 9. 네이버 검색광고
- 비용 1,266,547원(전주 1,339,371), 클릭 5,357, 전환 438(445), CPA 2,892원(3,010).
- 비즈머니 564,697원 ≈ 3.1일분. 입찰가: 부동산경매사이트 400→380, 무료경매사이트 250→230, 부동산경매 300→280 인하 확인. 대법원경매·대법원경매정보·경매(부산/경남 PC)는 그대로.
- GA4 광고 유입(m.ad.search.naver.com) 178세션·가입 1 — 광고 랜딩 UTM 부재로 직접 유입에 섞이는 것으로 보임(추정).

## 10. 진행 체크
{t([[c['item'],c['status'],c['evidence']] for c in checks],['항목','상태','근거'])}

## 11. 경고
""" + "\n".join(f"- [{w['level']}] {w['text']}" for w in warnings) + """

## 12. 실행 과제
""" + "\n".join(f"{i+1}. {x}" for i,x in enumerate(todos)) + """

> 기간 비교는 상관관계로만 해석. 원인은 모두 추정.
"""
notes=["데이터 원천: GA4·YouTube·네이버 검색광고(GitHub Actions collect, 2026-10-22T23:23 UTC 수동 재실행). 금 07:30 정기 collect 실행 기록이 없어 분석 중 직접 실행함 — 예약 실행 설정 확인 필요.",
 "원자료 errors: instagram/account 'HTTP 400: API access blocked (code 200)', naver/campaign_device_cur '상세 데이터는 최근 7일 이내 기간에서만 사용 가능'. 인스타 kpis·reels와 네이버 기기별 값은 data/2026-10-19.json(10/19 수집)에서 가져옴.",
 "GA4 수치는 10/19 수집과 동일(확정). 유튜브는 10/19 수집 때 10/17~18 미집계 → 이번 확정치로 정정(corrections 참조). 날짜는 미국 태평양 시간 기준.",
 "CRM: crm.my-auction.co.kr graph.php·graph2.php 집계값(현재 회원 기준). 10/19~22는 참고용.",
 "릴스 formula_ok 기준: 훅에 금액 2개 이상 대비 + 지역/단지명 + 평형이 모두 있을 때 true. 캡션이 '법원 경매N계 사건번호 [유형]' 형식이라 지역·평형은 훅 문구로만 판단.",
 "youtube_sessions = youtube / video 세션. youtube.com/referral 23세션 별도.",
 "Search Console·Google Ads는 연결 필요(search_console = null).",
 "기간 비교는 상관관계로만 해석."]
out={"report_key":KEY,"site":"myauction","type":"weekly","report_date":RUN,"period":{"start":"2026-10-12","end":"2026-10-18"},"compare_period":{"start":"2026-10-05","end":"2026-10-11"},
 "title":"마이옥션 주간 마케팅 점검 "+RUN,"summary":summary,"kpis":kpis,"highlights":highlights,"warnings":warnings,"checks":checks,"todos":todos,"reels":reels,
 "channels":ch,"devices":P['devices'],"landing":P['landing'],"audience":P['audience'],"youtube":yt,"search_console":None,"ads":ads,"corrections":corrections,
 "content_md":md,"html":None,"crm":crm,"notes":notes,"generator":{"name":"marketing-briefing-routine","run_id":KEY+"-"+datetime.datetime.utcnow().strftime('%H%M%S')}}
json.dump(out,open('payload.json','w'),ensure_ascii=False,indent=1)
open('content.md','w').write(md)
# validate
v=json.load(open('payload.json')); import re,os
for k in ['report_key','site','type','report_date','period','compare_period','title','summary','kpis','content_md']: assert k in v,k
for dt in [v['report_date'],*v['period'].values(),*v['compare_period'].values()]: assert re.fullmatch(r'\d{4}-\d{2}-\d{2}',dt)
for k,x in v['kpis'].items(): assert x is None or isinstance(x,(int,float)),k
assert os.path.getsize('payload.json')<5e6
print('OK',len(summary),os.path.getsize('payload.json'))
