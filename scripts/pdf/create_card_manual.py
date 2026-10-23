from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
# Requires reportlab and Windows Malgun Gothic fonts.
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from xml.sax.saxutils import escape

OUT = ROOT / 'output/pdf/마이옥션_전자명함_사용설명서.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Malgun', 'C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('MalgunBold', 'C:/Windows/Fonts/malgunbd.ttf'))
pdfmetrics.registerFontFamily('Malgun', normal='Malgun', bold='MalgunBold')
W,H=A4
M=45
CW=W-2*M
NAVY=HexColor('#142D4E'); INK=HexColor('#23364C'); MUTED=HexColor('#5D6F84')
TEAL=HexColor('#087F8C'); PALE=HexColor('#EEF5F9'); LINE=HexColor('#DAE5ED')
c=canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle('마이옥션 전자명함 사용설명서')
c.setAuthor('마이옥션')
c.setSubject('일반 사용자용 전자명함 제작, 수정, 공유 및 통계 안내')
y=0

def para(text, size=10.5, color=INK, bold=False, width=CW, x=M, gap=10):
    global y
    style=ParagraphStyle('body',fontName='MalgunBold' if bold else 'Malgun',fontSize=size,leading=size*1.65,textColor=color,wordWrap='CJK',alignment=TA_LEFT)
    p=Paragraph(text.replace('\n','<br/>'),style)
    _,hh=p.wrap(width,750)
    assert y-hh>48, f'Page overflow: {text[:50]} at {y}'
    p.drawOn(c,x,y-hh);y-=hh+gap

def heading(text):
    global y
    y-=5
    para(text,14,NAVY,True,gap=10)

def box(title,text):
    global y
    style=ParagraphStyle('box',fontName='Malgun',fontSize=10,leading=16.5,textColor=INK,wordWrap='CJK')
    p=Paragraph('<b>'+title+'</b><br/>'+text.replace('\n','<br/>'),style)
    _,hh=p.wrap(CW-30,700)
    height=hh+25
    assert y-height>48
    c.setFillColor(PALE);c.roundRect(M,y-height,CW,height,9,fill=1,stroke=0)
    c.setFillColor(TEAL);c.roundRect(M,y-height,4,height,2,fill=1,stroke=0)
    p.drawOn(c,M+15,y-12-hh);y-=height+16

def table(rows, widths):
    global y
    style=ParagraphStyle('cell',fontName='Malgun',fontSize=9.5,leading=15.5,textColor=INK,wordWrap='CJK')
    cells=[[Paragraph(escape(t).replace('\n','<br/>'),style) for t in row] for row in rows]
    t=Table(cells,colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),PALE),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.5,LINE),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10)]))
    _,hh=t.wrap(CW,700)
    assert y-hh>48, f'Table overflow at {y}, height {hh}'
    t.drawOn(c,M,y-hh);y-=hh+16

def page(number,kicker,title,sub):
    global y
    if number>1:c.showPage()
    c.setFillColor(NAVY);c.rect(0,H-12,W,12,fill=1,stroke=0)
    c.setFont('MalgunBold',9);c.setFillColor(TEAL);c.drawString(M,H-48,'MY AUCTION  /  USER GUIDE')
    c.setFont('Malgun',8);c.setFillColor(MUTED);c.drawRightString(W-M,H-48,kicker)
    y=H-75
    para(title,25,NAVY,True,gap=8)
    para(sub,10,MUTED,gap=22)
    c.setStrokeColor(LINE);c.line(M,38,W-M,38)
    c.setFont('Malgun',8);c.setFillColor(MUTED);c.drawString(M,24,'전자명함 사용설명서  |  2026.10.23 기준')
    c.drawRightString(W-M,24,f'{number:02d} / 07')

def step(num,title,body):
    global y
    top=y
    c.setFillColor(TEAL);c.circle(M+14,top-14,14,fill=1,stroke=0)
    c.setFillColor(white);c.setFont('MalgunBold',11);c.drawCentredString(M+14,top-18,str(num))
    para(title,12,NAVY,True,width=CW-43,x=M+43,gap=3)
    para(body,10,width=CW-43,x=M+43,gap=16)

page(1,'01  시작하기','나의 전자명함 사용설명서','통화 후 소개부터 다음 상담까지, 나만의 링크로 연결하세요.')
box('접속 경로','마이옥션 오피스 로그인 → 마이페이지 → 전자명함<br/><link href="https://my-docs.kr/business-card" color="#087F8C">https://my-docs.kr/business-card</link>')
heading('처음 사용할 때는 이 순서대로')
step(1,'기본 정보 확인','이름·소속·직책·지점·휴대전화가 본인 정보인지 확인합니다.')
step(2,'사진과 소개 작성','사진을 선택하거나 촬영하고, 소개 문구와 전문 분야를 작성합니다.')
step(3,'미리보기 확인','이름 박스, 사진의 잘림, 문구와 연락처를 확인합니다.')
step(4,'최종 저장으로 공개','우측 상단의 최종 저장을 누릅니다. 상태가 공개 중인지 확인합니다.')
step(5,'고객에게 전달','링크만 복사하거나 안내 문구 + 링크 복사를 눌러 문자에 붙여 넣습니다.')
box('관리 화면과 고객 화면은 다릅니다','관리 화면은 로그인 후 본인 명함을 편집하는 곳입니다. 공개 명함은 고객이 로그인 없이 보는 별도 페이지입니다. 공개한 사진과 연락처는 링크를 아는 사람이 열람할 수 있습니다.')
para('찾아보기  02 정보·사진  /  03 소개·디자인  /  04 저장·공개\n05 고객에게 전달  /  06 고객 화면·통계  /  07 문제 해결',9,MUTED)

page(2,'02  정보와 사진','기본 정보 확인 · 사진 등록','새 명함은 바로 편집할 수 있습니다. 기존 명함은 먼저 ‘수정’을 누르세요.')
table([['항목','어디에서 바꾸나요?'],['이름 / 부서·팀 / 직책\n지점·본사 / 담당자 휴대전화','사용자 설정 정보를 자동으로 불러옵니다.\n명함에서는 수정할 수 없습니다. 정보가 다르면 사용자 설정의 변경 가능 여부를 확인하거나 담당 부서에 정정을 요청하세요.'],['이메일','가입 이메일이 기본값입니다. 명함에서 직접 수정할 수 있습니다.'],['휴대전화 표시','010.1234.5678 형식으로 표시됩니다.']], [170,CW-170])
para('사용자 설정 변경 사항은 관리 화면이나 공개 명함을 다시 불러올 때 반영됩니다.',9.5,MUTED)
heading('사진을 등록하는 두 가지 방법')
step(1,'사진첩 · 파일 선택','저장된 본인 사진을 선택합니다. 사진 접근 요청이 나오면 사용할 사진에 대한 접근을 허용합니다.')
step(2,'카메라로 촬영','촬영 화면에서 사진을 찍고 사용을 확인합니다. 기기·브라우저가 지원하는 경우 카메라가 열리며 권한을 요청할 수 있습니다.')
box('사진 준비 기준','지원 형식: JPG·PNG·WebP / 선택 파일 최대 12MB<br/>권장 제작 크기: 세로 2:3 비율, 1000×1500px<br/>인물은 중앙, 머리 위와 좌우에 여백을 두세요. 하단에는 이름 박스가 겹칩니다. 업로드 후 자동 압축되며 너무 큰 사진은 더 작게 준비해야 할 수 있습니다.')
para('사진 교체·제거 후에는 최종 저장을 눌러야 공개 명함에 반영됩니다. ‘이미지 보정 요청’ 버튼으로 사진 보정 상담을 받을 수 있습니다.',10)

page(3,'03  내용과 디자인','나에게 맞는 소개로 완성하기','필요한 항목만 사용하세요. 작성 내용은 최종 저장 전까지 공개되지 않습니다.')
table([['항목','입력 방법'],['첫 인사 문구','고객에게 전하고 싶은 짧은 인사나 상담 방향을 적습니다.'],['전문 분야 · 강점 태그','쉼표로 구분합니다.\n예: 고객 신뢰, 꼼꼼한 상담, 투자 목적 분석'],['소개 문구','상담 방식과 고객에게 제공할 도움을 설명합니다.'],['경력 · 약력','줄바꿈으로 구분합니다. 실제 이력·자격·경험만 작성하세요.'],['이름 박스 색상','블랙·블루·네이비·실버·그린 중 선택합니다.\n색상에 맞춰 로고와 글씨가 자동으로 바뀝니다.']], [145,CW-145])
box('공통 기본문구 활용','새 명함에는 보편적인 경매 상담 안내가 들어 있습니다. 직접 수정할 수 있으며 ‘소개·약력 기본문구 채우기’로 다시 채울 수도 있습니다. 교체 확인창이 나오면 기존 내용이 바뀌는지 확인하세요. 기본문구는 실제 경력을 증명하는 내용이 아닙니다.')
heading('선택 기능')
para('<b>카카오톡 상담 링크</b>  본인의 카카오 오픈채팅 또는 채널 HTTPS 주소를 입력합니다. 비워두면 번호 복사와 친구 추가 안내가 나옵니다. 휴대전화 번호만으로 개인 채팅방을 바로 열지는 않습니다.')
para('<b>SNS 바로가기</b>  Instagram·네이버 블로그·YouTube를 선택하고 + 추가를 누른 뒤 주소를 입력합니다. 고객 화면에는 주소 대신 로고가 표시됩니다.')
para('<b>유튜브 소개 영상</b>  사용을 체크하고 영상 1편의 주소를 입력합니다. 채널 주소가 아닌 영상 주소를 사용하고, 공개 페이지에서 재생 여부를 확인하세요.')
para('<b>하단 회사소개</b>  기본 회사소개를 사용하거나 ‘사용 안 함’으로 숨길 수 있습니다. 커스텀 이미지를 첨부하면 기본 소개 대신 표시됩니다. 이미지 제거 시 기본 소개로 돌아옵니다.')

page(4,'04  저장과 공개','저장 버튼의 차이를 알아두세요','초안 저장과 최종 저장, 안내 문구 저장은 서로 다른 기능입니다.')
table([['버튼','무엇이 달라지나요?'],['수정','기존 명함의 입력란을 편집할 수 있게 합니다.'],['미리보기 / 미리보기 갱신','지금 작성한 명함을 확인합니다. 공개 저장은 아닙니다.'],['초안 저장','작성 중인 내용을 보관합니다. 기존 공개 명함은 바뀌지 않습니다.'],['최종 저장 / 공개 내용 적용','현재 작성 내용을 공개 명함에 반영합니다. 처음 저장하는 경우 명함을 공개합니다.'],['비공개 전환','공개 명함을 닫습니다. 기존 링크를 가진 고객도 열 수 없습니다.\n기존 명함은 수정 버튼을 누른 후 편집 영역에서 선택합니다.'],['안내 문구 저장','고객에게 보낼 문자 문구만 저장합니다. 명함 사진이나 공개 내용은 바뀌지 않습니다.']], [153,CW-153])
heading('고객에게 보내기 전 확인')
step(1,'최종 저장 완료 메시지 확인','초안 저장만 한 것은 아닌지 확인합니다.')
step(2,'공개 중 상태 확인','비공개라면 링크를 고객에게 보내지 않습니다.')
step(3,'공개 명함 열기에서 실제 화면 확인','사진·이메일·전화번호·카카오톡 연결을 확인합니다. 미리보기에서는 영상 재생과 연락처 저장을 확인할 수 없습니다.')
box('한 번 보낸 주소는 다시 활용할 수 있습니다','같은 명함의 내용을 수정해 최종 저장하면 기존 링크에서도 변경 내용을 볼 수 있습니다. 다만 문자·메신저가 보관한 미리보기 이미지는 늦게 바뀔 수 있습니다.')

page(5,'05  공유하기','통화 후 고객에게 전달하기','모바일에서는 제목·저장 버튼 아래에 ‘고객에게 전달하기’가 먼저 표시됩니다.')
step(1,'링크만 보낼 때','링크만 복사 → 문자 또는 카카오톡 열기 → 입력창에 붙여 넣기 → 직접 전송합니다.')
step(2,'인사말과 함께 보낼 때','고객 안내 문구 확인·수정 → 안내 문구 저장 → 안내 문구 + 링크 복사 → 문자 입력창에 붙여 넣기 → 직접 전송합니다.')
box('기본 안내 문구 예시','안녕하세요. 방금 통화드린 마이옥션 홍길동 팀장입니다.<br/>경매 상담과 관련해 제 소개와 주요 상담 분야를 보내드립니다.<br/>아래에서 연락처를 저장하실 수 있으며, 궁금한 물건의 사건번호를 이 문자로 보내주셔도 됩니다.<br/>[프로필 링크 / 전자명함]<br/>https://my-docs.kr/card/본인코드<br/><br/>위 이름과 주소는 예시입니다. 실제 화면에는 본인 정보와 명함 주소가 들어갑니다.')
heading('문구 수정 시 알아두기')
para('• 기본 문구의 이름·직책·링크는 실제 값으로 표시됩니다. 자동 입력 부분을 지우거나 직접 바꾸면 자동 반영이 해제될 수 있습니다.\n• ‘기본문구 복원’을 누르면 기본 안내로 돌아갑니다. 다시 ‘안내 문구 저장’을 눌러 보관하세요.\n• 명함 주소가 빠졌다면 ‘명함 주소 추가’를 누릅니다.\n• 복사는 저장 여부와 관계없이 현재 작성한 내용을 사용합니다. ‘복사될 내용’을 확인하세요.')
box('전송 직전 꼭 확인','고객에게는 운영 주소인 my-docs.kr에서 복사한 링크를 보내세요. localhost 주소는 다른 사람이 열 수 없습니다. 링크는 마지막 줄에 단독으로 두고, 주소 자체를 대괄호로 감싸지 마세요. 문자 발송은 사용자가 직접 하며 자동 발송 기능은 없습니다.')

page(6,'06  고객 화면과 통계','고객은 이렇게 이용합니다','고객 화면은 로그인 없이 열리는 모바일 중심의 전자명함입니다.')
para('<b>전화 상담</b>  휴대전화의 전화 연결 화면으로 이동합니다.<br/><b>카카오톡 상담</b>  등록한 상담 링크를 열거나 번호 복사·친구 추가 방법을 안내합니다.<br/><b>＋ 연락처 저장</b>  VCF 연락처 파일을 엽니다. 기기에 따라 추가 화면에서 저장하거나 다운로드한 파일을 연락처 앱으로 가져와야 합니다. 자동으로 전화번호부에 등록되지는 않습니다.<br/><b>SNS·소개 영상·회사소개</b>  등록한 링크와 영상, 회사소개를 확인합니다. 회사소개 이미지는 누르면 확대할 수 있습니다.')
heading('방문 통계 읽는 방법')
table([['지표','의미'],['명함 방문','방문 집계 횟수입니다. 같은 브라우저의 30분 내 방문은 묶어 집계합니다.'],['추정 방문자','브라우저 식별자를 기준으로 한 추정치입니다. 실제 사람 수와 같지 않을 수 있습니다.'],['추정 재방문','방문 수에서 추정 방문자 수를 뺀 참고값입니다.'],['전화 클릭 / 카카오톡 클릭','각 상담 버튼을 누른 횟수입니다. 실제 통화·상담 완료를 뜻하지 않습니다.'],['연락처 저장 클릭','연락처 저장 버튼을 누른 횟수입니다. 전화번호부 저장 완료를 뜻하지 않습니다.']], [163,CW-163])
box('통계는 관심도 참고용입니다','통계는 누적값이며 관리 화면을 새로고침해 확인할 수 있습니다. 기기·브라우저 변경이나 저장정보 삭제로 방문자가 다르게 집계될 수 있습니다. 미리보기 화면은 집계되지 않지만 본인이 공개 명함을 직접 열면 방문으로 집계될 수 있습니다.')

page(7,'07  도움말','막히는 부분은 여기서 확인하세요','기기·브라우저에 따라 표시와 권한 요청 방식이 달라질 수 있습니다.')
table([['상황','확인할 내용'],['입력란이 수정되지 않아요','기존 명함은 우측 상단 수정 버튼을 누르세요. 이름·소속·직책·지점·휴대전화는 명함에서 수정할 수 없습니다.'],['사진첩·카메라가 안 열려요','기기·브라우저의 사진/카메라 권한을 확인하세요. 카카오톡 내부 브라우저에서 안 되면 Safari 또는 Chrome에서 관리 페이지를 여세요.'],['사진 업로드가 거절돼요','12MB 이하 JPG·PNG·WebP인지 확인하세요. HEIC 등 미지원 파일은 JPG로 변환하세요. 파일이 크면 크기를 줄여 다시 선택합니다.'],['고객에게 명함이 안 보여요','공개 중 상태인지, 운영 페이지에서 복사한 주소인지 확인하세요. 주소를 다시 복사해 보내고 임의로 편집하지 마세요.'],['문자 미리보기 사진이 없어요','문자 앱의 지원·설정·보안 정책에 따라 미리보기가 표시되지 않을 수 있습니다. 미리보기 표시 여부와 링크 접속 가능 여부는 별개입니다.'],['링크를 열 때 경고가 떠요','문자 앱의 보안 확인창일 수 있습니다. 보안 기능을 끄도록 유도하지 말고, 발신자와 주소를 확인한 후 열도록 안내하세요.'],['변경한 사진·문구가 그대로예요','최종 저장 여부를 확인하고 공개 페이지를 새로고침하세요. 문자 미리보기 캐시는 즉시 바뀌지 않을 수 있습니다.'],['주소·문구 복사가 안 돼요','복사될 내용이나 주소를 길게 눌러 선택한 뒤 직접 복사하세요.']], [157,CW-157])
box('전송 전 마지막 5가지','본인 연락처 확인 / 사진과 소개 확인 / 최종 저장 완료 / 공개 명함 열기 확인 / 운영 링크 복사')
para('이 설명서는 2026년 10월 23일 기능 기준입니다. 화면 구성과 휴대폰의 권한·연락처 가져오기 화면은 업데이트 및 기기 환경에 따라 달라질 수 있습니다.',9,MUTED)
c.save()
print(OUT)

# PDF text and layout checks, then render every page for visual review.
from pypdf import PdfReader
reader=PdfReader(str(OUT))
assert len(reader.pages)==7
text='\n'.join(p.extract_text() for p in reader.pages)
assert '마스터' not in text and '대리 관리' not in text
assert '[프로필 링크 / 전자명함]' in text
import pymupdf
doc=pymupdf.open(str(OUT))
renderdir=ROOT/'tmp/pdfs/rendered'
renderdir.mkdir(parents=True,exist_ok=True)
for i,p in enumerate(doc):
    p.get_pixmap(matrix=pymupdf.Matrix(1.25,1.25)).save(str(renderdir/f'page-{i+1}.png'))
print('Verified 7 pages; rendered all pages; no privileged management content.')
